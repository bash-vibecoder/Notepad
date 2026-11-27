// SPDX-License-Identifier: MIT
// Original small Win32 host for the shared Android/Windows/Linux AnoteP editor.
#define UNICODE
#define _UNICODE
#define NOMINMAX
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <shellapi.h>
#include <shlobj.h>
#include <shobjidl.h>
#include <wrl.h>
#include <WebView2.h>
#include <WebView2EnvironmentOptions.h>
#include <cstdio>
#include <memory>
#include "core.h"
#include "migrate.h"
#include "version.h"

using namespace anotep;
using Microsoft::WRL::Callback;
using Microsoft::WRL::ComPtr;
constexpr wchar_t origin[] = L"https://anotep.local/";
constexpr wchar_t editorUrl[] = L"https://anotep.local/index.html";
constexpr UINT_PTR startupRetryTimer = 1;
class App;
App* application = nullptr;

fs::path folder(int kind)
{
    wchar_t path[MAX_PATH]{};
    require(SUCCEEDED(SHGetFolderPathW(nullptr, kind | CSIDL_FLAG_DONT_VERIFY, nullptr, SHGFP_TYPE_CURRENT, path)), "The user profile folder could not be located.");
    return checkedLocal(fs::path(path));
}

class App
{
public:
    HWND window = nullptr;
    fs::path executable, assets, profile, oldProfile, cache;
    std::vector<fs::path> initialFiles;
    bool ready = false, closing = false;
    ULONGLONG startupDeadline = 0;
    int exitCode = 0;
    HANDLE profileLock = INVALID_HANDLE_VALUE;
    std::string selectedFolder;
    ComPtr<ICoreWebView2Environment> environment;
    ComPtr<ICoreWebView2Controller> controller;
    ComPtr<ICoreWebView2> web;

    ~App()
    {
        application = nullptr;
        closing = true;
        if (controller) controller->Close();
        if (IsWindow(window)) DestroyWindow(window);
        if (profileLock != INVALID_HANDLE_VALUE) CloseHandle(profileLock);
    }

    void error(const std::string& message)
    {
        const auto diagnostic = "AnoteP: " + message + "\n";
        DWORD written = 0;
        WriteFile(GetStdHandle(STD_ERROR_HANDLE), diagnostic.data(), static_cast<DWORD>(diagnostic.size()), &written, nullptr);
        std::wstring value;
        try { value = wide(message); }
        catch (...) { value = L"The local operation failed. Your files have not been discarded."; }
        MessageBoxW(window, value.c_str(), L"AnoteP", MB_OK | MB_ICONERROR);
    }

    void execute(const std::string& source)
    {
        if (web) web->ExecuteScript(wide(source).c_str(), nullptr);
    }

    void emit(const std::string& type, const json& payload = json::object(), const std::string& request = "")
    {
        if (web) web->PostWebMessageAsJson(wide(json({{"type", type}, {"payload", payload}, {"requestId", request}}).dump(-1, ' ', false, json::error_handler_t::replace)).c_str());
    }

    void persist(const json& state)
    {
        validateWorkspace(state);
        fs::create_directories(profile);
        atomicWrite(profile / L"workspace.json", state.dump());
        // A queued pre-picker recovery snapshot must not revoke the current
        // folder selection. Runtime access changes only at bootstrap/picker.
    }

    void bootstrap()
    {
        json state = {{"version", 1}, {"documents", json::array()}, {"settings", json::object()}};
        const auto workspace = profile / L"workspace.json";
        try
        {
            if (fs::exists(workspace))
            {
                try
                {
                    auto loaded = json::parse(readFile(workspace, maxSession));
                    validateWorkspace(loaded);
                    state = std::move(loaded);
                }
                catch (const std::exception&)
                {
                    fs::copy_file(workspace, profile / (L"workspace-unreadable-" + std::to_wstring(GetTickCount64()) + L".json"));
                    emit("error", {{"message", "The old recovery file was unreadable. A byte-for-byte copy was preserved beside workspace.json."}});
                }
            }
        }
        catch (const std::exception& failure)
        {
            exitCode = 1;
            error(std::string("Recovery could not be safely loaded. Existing files are preserved.\n") + failure.what());
            DestroyWindow(window);
            return;
        }
        try { state = importNative(state, profile, oldProfile); }
        catch (const std::exception& failure) { emit("error", {{"message", std::string("The previous native session could not be imported. Its files are preserved. ") + failure.what()}}); }
        selectedFolder = state.value("settings", json::object()).value("folderUri", "");
        ready = true;
        emit("bootstrap", state);
        for (const auto& path : initialFiles)
        {
            try { emit("opened", opened(uri(checkedLocal(path)))); }
            catch (const std::exception& failure) { emit("error", {{"message", failure.what()}}); }
        }
        initialFiles.clear();
    }

    std::vector<fs::path> choose(bool save, bool directory = false, const std::string& name = "")
    {
        ComPtr<IFileDialog> dialog;
        HRESULT result = save ? CoCreateInstance(CLSID_FileSaveDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog))
                              : CoCreateInstance(CLSID_FileOpenDialog, nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&dialog));
        require(SUCCEEDED(result), "Windows file dialog is unavailable.");
        DWORD options = 0;
        dialog->GetOptions(&options);
        options |= FOS_FORCEFILESYSTEM | FOS_PATHMUSTEXIST | FOS_NOCHANGEDIR;
        if (directory) options |= FOS_PICKFOLDERS;
        else if (save) options |= FOS_OVERWRITEPROMPT;
        else options |= FOS_ALLOWMULTISELECT | FOS_FILEMUSTEXIST;
        dialog->SetOptions(options);
        dialog->SetTitle(save ? L"Save document" : directory ? L"Choose local workspace folder" : L"Open local documents");
        if (save && !name.empty()) dialog->SetFileName(wide(name).c_str());
        result = dialog->Show(window);
        if (result == HRESULT_FROM_WIN32(ERROR_CANCELLED)) return {};
        require(SUCCEEDED(result), "The local file dialog failed.");
        std::vector<fs::path> paths;
        const auto add = [&](IShellItem* item)
        {
            PWSTR path = nullptr;
            if (SUCCEEDED(item->GetDisplayName(SIGDN_FILESYSPATH, &path)))
            {
                try { paths.push_back(checkedLocal(fs::path(path))); }
                catch (...) { CoTaskMemFree(path); throw; }
                CoTaskMemFree(path);
            }
        };
        if (!save && !directory)
        {
            ComPtr<IFileOpenDialog> open;
            dialog.As(&open);
            ComPtr<IShellItemArray> items;
            open->GetResults(&items);
            DWORD count = 0;
            if (items) items->GetCount(&count);
            for (DWORD index = 0; index < count && index < 30; ++index)
            {
                ComPtr<IShellItem> item; items->GetItemAt(index, &item); if (item) add(item.Get());
            }
        }
        else
        {
            ComPtr<IShellItem> item;
            dialog->GetResult(&item);
            if (item) add(item.Get());
        }
        return paths;
    }

    void save(const json& payload, const std::string& request)
    {
        const auto data = encode(payload.at("text"), payload.at("encoding"), payload.at("eol"));
        const bool pick = payload.value("saveAs", false) || payload.value("uri", "").empty();
        fs::path path;
        if (pick)
        {
            auto name = payload.value("name", "document.txt");
            if (starts(name, "new ")) name = "document.txt";
            auto paths = choose(true, false, utf8(fs::path(wide(name)).filename().wstring()));
            if (paths.empty()) { emit("cancelled", json::object(), request); return; }
            path = paths.front();
        }
        else path = pathFromUri(payload.at("uri"));
        const auto expected = payload.value("fingerprint", "");
        if (!pick && !payload.value("force", false) && !expected.empty())
        {
            const auto actual = fs::exists(path) ? fingerprint(readFile(path)) : "";
            if (actual != expected) { emit("conflict", {{"name", utf8(path.filename().wstring())}}, request); return; }
        }
        atomicWrite(path, data);
        emit("saved", {{"id", payload.at("id")}, {"uri", uri(path)}, {"name", utf8(path.filename().wstring())}, {"fingerprint", fingerprint(data)}}, request);
    }

    void copy(const std::string& text)
    {
        const auto value = wide(text);
        require(OpenClipboard(window), "The clipboard is busy. Try again.");
        HGLOBAL memory = GlobalAlloc(GMEM_MOVEABLE, (value.size() + 1) * sizeof(wchar_t));
        if (!memory) { CloseClipboard(); throw std::runtime_error("Could not allocate clipboard memory."); }
        auto target = GlobalLock(memory);
        if (!target) { GlobalFree(memory); CloseClipboard(); throw std::runtime_error("Clipboard memory is unavailable."); }
        memcpy(target, value.c_str(), (value.size() + 1) * sizeof(wchar_t));
        GlobalUnlock(memory);
        EmptyClipboard();
        if (!SetClipboardData(CF_UNICODETEXT, memory)) { GlobalFree(memory); CloseClipboard(); throw std::runtime_error("Could not copy to the clipboard."); }
        CloseClipboard();
    }

    std::string paste()
    {
        require(OpenClipboard(window), "The clipboard is busy. Try again.");
        auto memory = GetClipboardData(CF_UNICODETEXT);
        std::string text;
        if (memory)
        {
            const auto value = static_cast<const wchar_t*>(GlobalLock(memory));
            if (value) { text = utf8(value); GlobalUnlock(memory); }
        }
        CloseClipboard();
        return text;
    }

    void dispatch(const std::string& raw)
    {
        std::string request;
        try
        {
            require(raw.size() <= maxSession, "The editor request is too large.");
            const auto command = json::parse(raw);
            const std::string type = command.at("type");
            const auto payload = command.value("payload", json::object());
            request = command.value("requestId", "");
            if (type == "ready") bootstrap();
            else if (type == "persist") persist(payload);
            else if (type == "open")
            {
                for (const auto& path : choose(false))
                {
                    try { emit("opened", opened(uri(path))); }
                    catch (const std::exception& failure) { emit("error", {{"message", failure.what()}}); }
                }
            }
            else if (type == "openUri") emit("opened", opened(payload.at("uri"), payload.value("encoding", ""), payload.value("line", 0)));
            else if (type == "save") save(payload, request);
            else if (type == "chooseFolder")
            {
                auto paths = choose(false, true);
                if (!paths.empty()) { selectedFolder = uri(paths.front()); emit("folderChosen", {{"uri", selectedFolder}, {"name", utf8(paths.front().filename().wstring())}}); }
            }
            else if (type == "listFolder") emit("folderListing", listing(selectedFolder, payload.at("uri")), request);
            else if (type == "findInFiles") execute("window.__anotepSearch(" + candidates(selectedFolder).dump() + "," + payload.dump() + "," + json(request).dump() + ");");
            else if (type == "copy") { copy(payload.value("text", "")); emit("copied", json::object(), request); }
            else if (type == "paste") emit("pasted", {{"text", paste()}}, request);
            else if (type == "licenses") emit("licenses", {{"text", readFile(assets / L"licenses.txt")}}, request);
            else if (type == "close") close();
            else require(type == "theme" || type == "hideKeyboard", "Unknown editor request.");
        }
        catch (const std::exception& failure) { emit("error", {{"message", failure.what()}}, request); }
    }

    void close()
    {
        if (closing) return;
        if (!ready || !web) { DestroyWindow(window); return; }
        closing = true;
        const auto result = web->ExecuteScript(L"JSON.stringify(window.App.captureWorkspace())", Callback<ICoreWebView2ExecuteScriptCompletedHandler>(
            [this](HRESULT status, LPCWSTR result) -> HRESULT
            {
                try
                {
                    require(SUCCEEDED(status) && result, "The editor could not provide its latest recovery snapshot.");
                    const auto encoded = json::parse(utf8(result));
                    require(encoded.is_string(), "The recovery snapshot is not available.");
                    persist(json::parse(encoded.get<std::string>()));
                    if (controller) controller->Close();
                    DestroyWindow(window);
                }
                catch (const std::exception& failure) { closing = false; error(std::string("Recovery could not be saved. Your text is still open.\n") + failure.what()); }
                return S_OK;
            }).Get());
        if (FAILED(result)) { closing = false; error("The editor could not be contacted. Save your tabs before closing."); }
    }

    void resize()
    {
        if (controller) { RECT bounds{}; GetClientRect(window, &bounds); controller->put_Bounds(bounds); }
    }

    void configure()
    {
        ComPtr<ICoreWebView2Settings> settings;
        web->get_Settings(&settings);
        settings->put_IsWebMessageEnabled(TRUE);
        settings->put_AreHostObjectsAllowed(FALSE);
        settings->put_AreDevToolsEnabled(FALSE);
        settings->put_AreDefaultContextMenusEnabled(FALSE);
        settings->put_IsStatusBarEnabled(FALSE);
        settings->put_AreDefaultScriptDialogsEnabled(FALSE);
        ComPtr<ICoreWebView2Settings4> settings4;
        if (SUCCEEDED(settings.As(&settings4)))
        {
            settings4->put_IsGeneralAutofillEnabled(FALSE);
            settings4->put_IsPasswordAutosaveEnabled(FALSE);
        }
        ComPtr<ICoreWebView2Settings3> settings3;
        if (SUCCEEDED(settings.As(&settings3))) settings3->put_AreBrowserAcceleratorKeysEnabled(FALSE);
        ComPtr<ICoreWebView2_3> mapping;
        require(SUCCEEDED(web.As(&mapping)), "Update the system WebView2 Runtime to use AnoteP.");
        require(SUCCEEDED(mapping->SetVirtualHostNameToFolderMapping(L"anotep.local", assets.c_str(), COREWEBVIEW2_HOST_RESOURCE_ACCESS_KIND_DENY_CORS)), "The bundled editor could not be mapped.");
        EventRegistrationToken token{};
        web->AddWebResourceRequestedFilter(L"*", COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL);
        web->add_WebResourceRequested(Callback<ICoreWebView2WebResourceRequestedEventHandler>([this](ICoreWebView2*, ICoreWebView2WebResourceRequestedEventArgs* args) -> HRESULT
        {
            ComPtr<ICoreWebView2WebResourceRequest> request;
            args->get_Request(&request);
            PWSTR value = nullptr;
            request->get_Uri(&value);
            std::wstring url = value ? value : L"";
            CoTaskMemFree(value);
            if (url.rfind(origin, 0) != 0)
            {
                ComPtr<ICoreWebView2WebResourceResponse> blocked;
                environment->CreateWebResourceResponse(nullptr, 403, L"Offline", L"Content-Type: text/plain\r\n", &blocked);
                args->put_Response(blocked.Get());
            }
            return S_OK;
        }).Get(), &token);
        web->add_NavigationStarting(Callback<ICoreWebView2NavigationStartingEventHandler>([](ICoreWebView2*, ICoreWebView2NavigationStartingEventArgs* args) -> HRESULT
        {
            PWSTR value = nullptr; args->get_Uri(&value);
            if (!value || wcscmp(value, editorUrl) != 0) args->put_Cancel(TRUE);
            CoTaskMemFree(value); return S_OK;
        }).Get(), &token);
        web->add_NewWindowRequested(Callback<ICoreWebView2NewWindowRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2NewWindowRequestedEventArgs* args) -> HRESULT { args->put_Handled(TRUE); return S_OK; }).Get(), &token);
        web->add_PermissionRequested(Callback<ICoreWebView2PermissionRequestedEventHandler>([](ICoreWebView2*, ICoreWebView2PermissionRequestedEventArgs* args) -> HRESULT { args->put_State(COREWEBVIEW2_PERMISSION_STATE_DENY); return S_OK; }).Get(), &token);
        ComPtr<ICoreWebView2_4> downloads;
        if (SUCCEEDED(web.As(&downloads))) downloads->add_DownloadStarting(Callback<ICoreWebView2DownloadStartingEventHandler>([](ICoreWebView2*, ICoreWebView2DownloadStartingEventArgs* args) -> HRESULT { args->put_Cancel(TRUE); args->put_Handled(TRUE); return S_OK; }).Get(), &token);
        web->add_WebMessageReceived(Callback<ICoreWebView2WebMessageReceivedEventHandler>([this](ICoreWebView2*, ICoreWebView2WebMessageReceivedEventArgs* args) -> HRESULT
        {
            PWSTR source = nullptr; args->get_Source(&source);
            bool trusted = source && wcscmp(source, editorUrl) == 0;
            CoTaskMemFree(source);
            if (!trusted) return S_OK;
            PWSTR raw = nullptr;
            if (SUCCEEDED(args->TryGetWebMessageAsString(&raw)) && raw)
            {
                auto message = utf8(raw); CoTaskMemFree(raw); dispatch(message);
            }
            return S_OK;
        }).Get(), &token);
        web->add_ProcessFailed(Callback<ICoreWebView2ProcessFailedEventHandler>([this](ICoreWebView2*, ICoreWebView2ProcessFailedEventArgs*) -> HRESULT
        {
            if (closing) return S_OK;
            ready = false;
            exitCode = 1;
            error("The system WebView2 process stopped. Reopen AnoteP to restore the most recent recovery snapshot.");
            DestroyWindow(window); return S_OK;
        }).Get(), &token);
        const auto bridge = wide(readFile(executable.parent_path() / L"bridge.js"));
        web->AddScriptToExecuteOnDocumentCreated(bridge.c_str(), Callback<ICoreWebView2AddScriptToExecuteOnDocumentCreatedCompletedHandler>([this](HRESULT status, LPCWSTR) -> HRESULT
        {
            if (FAILED(status)) { error("The local editor bridge could not be initialized."); DestroyWindow(window); return S_OK; }
            web->Navigate(editorUrl); return S_OK;
        }).Get());
        resize();
        controller->put_IsVisible(TRUE);
    }

    void initialize()
    {
        fs::create_directories(profile);
        profileLock = CreateFileW((profile / L"instance.lock").c_str(), GENERIC_READ | GENERIC_WRITE, 0, nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        require(profileLock != INVALID_HANDLE_VALUE, "This recovery profile is already in use or is not writable. Switch to the existing AnoteP window, or choose another --profile directory.");
        fs::create_directories(cache);
        startupDeadline = GetTickCount64() + 10000;
        createEnvironment();
    }

    void createEnvironment()
    {
        if (closing || !IsWindow(window)) return;
        auto options = Microsoft::WRL::Make<CoreWebView2EnvironmentOptions>();
        std::wstring browserArguments = L"--disable-background-networking --disable-component-update --disable-domain-reliability --disable-sync --no-first-run --disable-local-storage";
        // Honor the runtime's documented, user-supplied developer arguments.
        // No debugging endpoint is enabled by the application itself.
        DWORD argumentLength = GetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", nullptr, 0);
        if (argumentLength)
        {
            std::wstring additional(argumentLength, L'\0');
            GetEnvironmentVariableW(L"WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", additional.data(), argumentLength);
            additional.resize(wcslen(additional.c_str()));
            browserArguments += L" " + additional;
        }
        options->put_AdditionalBrowserArguments(browserArguments.c_str());
        const auto status = CreateCoreWebView2EnvironmentWithOptions(nullptr, cache.c_str(), options.Get(), Callback<ICoreWebView2CreateCoreWebView2EnvironmentCompletedHandler>(
            [this](HRESULT status, ICoreWebView2Environment* created) -> HRESULT
            {
                if (FAILED(status) || !created) { startupFailure(status, "environment"); return S_OK; }
                environment = created;
                const auto controllerStatus = environment->CreateCoreWebView2Controller(window, Callback<ICoreWebView2CreateCoreWebView2ControllerCompletedHandler>(
                    [this](HRESULT status, ICoreWebView2Controller* created) -> HRESULT
                    {
                        if (FAILED(status) || !created) { startupFailure(status, "controller"); return S_OK; }
                        controller = created;
                        controller->get_CoreWebView2(&web);
                        try { configure(); }
                        catch (const std::exception& failure) { error(failure.what()); DestroyWindow(window); }
                        return S_OK;
                    }).Get());
                if (FAILED(controllerStatus)) startupFailure(controllerStatus, "controller request");
                return S_OK;
            }).Get());
        if (FAILED(status)) startupFailure(status, "environment request");
    }

    void startupFailure(HRESULT status, const char* stage)
    {
        if (closing || !IsWindow(window)) return;
        // The previous runtime can still own this user-data folder just after
        // its host closes. Keep the profile lock and pump messages while it
        // finishes; never erase its cache or recovery to force a relaunch.
        if (status == HRESULT_FROM_WIN32(ERROR_BUSY) && GetTickCount64() < startupDeadline)
        {
            controller.Reset(); web.Reset(); environment.Reset();
            if (SetTimer(window, startupRetryTimer, 250, nullptr))
            {
                constexpr char message[] = "AnoteP: WebView2 startup is busy; retrying.\n";
                DWORD written = 0;
                WriteFile(GetStdHandle(STD_ERROR_HANDLE), message, sizeof(message) - 1, &written, nullptr);
                return;
            }
        }
        exitCode = 2;
        PWSTR runtime = nullptr;
        const auto found = GetAvailableCoreWebView2BrowserVersionString(nullptr, &runtime);
        const bool installed = SUCCEEDED(found) && runtime && *runtime;
        if (runtime) CoTaskMemFree(runtime);
        char code[16]{};
        std::snprintf(code, sizeof(code), "0x%08lX", static_cast<unsigned long>(FAILED(status) ? status : E_FAIL));
        const std::string diagnostic = std::string("\nWebView2 ") + stage + ": " + code;
        if (installed)
            error("The installed Microsoft Edge WebView2 Runtime could not start.\nClose AnoteP and try again. If this continues, repair the system WebView2 Runtime.\nYour saved recovery data has not been changed." + diagnostic);
        else
            error("AnoteP requires the Microsoft Edge WebView2 Runtime installed on this PC.\nInstall the matching Microsoft offline runtime installer, then reopen AnoteP.\nAnoteP does not download a runtime or connect to the Internet itself." + diagnostic);
        DestroyWindow(window);
    }
};

LRESULT CALLBACK windowProcedure(HWND window, UINT message, WPARAM first, LPARAM second)
{
    if (message == WM_SIZE && application) { application->resize(); return 0; }
    if (message == WM_TIMER && first == startupRetryTimer && application)
    {
        KillTimer(window, startupRetryTimer);
        application->createEnvironment();
        return 0;
    }
    if (message == WM_CLOSE && application) { application->close(); return 0; }
    if (message == WM_DESTROY) { PostQuitMessage(0); return 0; }
    return DefWindowProcW(window, message, first, second);
}

int WINAPI wWinMain(HINSTANCE instance, HINSTANCE, PWSTR, int show)
{
    HRESULT initialized = CoInitializeEx(nullptr, COINIT_APARTMENTTHREADED);
    if (FAILED(initialized)) return 1;
    int code = 0;
    try
    {
        App app;
        application = &app;
        wchar_t path[32768]{};
        GetModuleFileNameW(nullptr, path, 32768);
        app.executable = path;
        const auto root = app.executable.parent_path();
        const bool portable = fs::exists(root / L"portable.flag") || fs::exists(root / L"doLocalConf.xml");
        app.profile = portable ? root / L"profile" : folder(CSIDL_APPDATA) / L"AnoteP";
        app.assets = root / L"assets";
        int count = 0;
        auto arguments = CommandLineToArgvW(GetCommandLineW(), &count);
        for (int index = 1; index < count; ++index)
        {
            const std::wstring argument = arguments[index];
            if (argument == L"--check-runtime")
            {
                PWSTR runtime = nullptr;
                HRESULT found = GetAvailableCoreWebView2BrowserVersionString(nullptr, &runtime);
                if (runtime) CoTaskMemFree(runtime);
                LocalFree(arguments); CoUninitialize(); return SUCCEEDED(found) ? 0 : 2;
            }
            if (argument == L"--version")
            {
                const std::string value = "AnoteP " ANOTEP_VERSION "\n";
                HANDLE output = GetStdHandle(STD_OUTPUT_HANDLE);
                DWORD written = 0;
                if (!output || output == INVALID_HANDLE_VALUE || !WriteFile(output, value.data(), static_cast<DWORD>(value.size()), &written, nullptr))
                    MessageBoxW(nullptr, L"AnoteP " ANOTEP_VERSION_W, L"AnoteP version", MB_OK);
                LocalFree(arguments); CoUninitialize(); return 0;
            }
            if (argument == L"--profile" && index + 1 < count) app.profile = checkedLocal(fs::path(arguments[++index]));
            else if (argument == L"--assets" && index + 1 < count) app.assets = checkedLocal(fs::path(arguments[++index]));
            else if (!argument.empty() && argument[0] != L'-') app.initialFiles.emplace_back(argument);
        }
        LocalFree(arguments);
        app.profile = checkedLocal(app.profile);
        app.oldProfile = portable ? root : app.profile / L"Native";
        app.cache = app.profile / L"WebView2";
        require(fs::is_regular_file(app.assets / L"index.html"), "The bundled editor assets are missing. Extract the entire portable archive or reinstall AnoteP.");
        WNDCLASSEXW klass{sizeof(klass)};
        klass.lpfnWndProc = windowProcedure;
        klass.hInstance = instance;
        klass.lpszClassName = L"AnoteP";
        klass.hCursor = LoadCursorW(nullptr, IDC_ARROW);
        klass.hIcon = LoadIconW(instance, MAKEINTRESOURCEW(101));
        klass.hIconSm = klass.hIcon;
        RegisterClassExW(&klass);
        app.window = CreateWindowExW(0, klass.lpszClassName, L"AnoteP " ANOTEP_VERSION_W,
            WS_OVERLAPPEDWINDOW, CW_USEDEFAULT, CW_USEDEFAULT, 1200, 820, nullptr, nullptr, instance, nullptr);
        require(app.window != nullptr, "The application window could not be created.");
        ShowWindow(app.window, show);
        app.initialize();
        MSG message{};
        while (GetMessageW(&message, nullptr, 0, 0) > 0) { TranslateMessage(&message); DispatchMessageW(&message); }
        code = app.exitCode;
        app.controller.Reset(); app.web.Reset(); app.environment.Reset();
        application = nullptr;
    }
    catch (const std::exception& failure) { MessageBoxW(nullptr, wide(failure.what()).c_str(), L"AnoteP", MB_OK | MB_ICONERROR); code = 1; }
    CoUninitialize();
    return code;
}
