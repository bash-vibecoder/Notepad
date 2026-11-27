// SPDX-License-Identifier: MIT
#pragma once
#include <windows.h>
#include <wincrypt.h>
#include <filesystem>
#include <algorithm>
#include <cctype>
#include <cwctype>
#include <fstream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>
#include "vendor/json.hpp"

namespace anotep
{
using json = nlohmann::json;
namespace fs = std::filesystem;
constexpr size_t maxFile = 8 * 1024 * 1024;
constexpr size_t maxSession = 32 * 1024 * 1024;

inline void require(bool condition, const char* message)
{
    if (!condition) throw std::runtime_error(message);
}

inline std::wstring wide(const std::string& value)
{
    if (value.empty()) return {};
    int length = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0);
    require(length > 0, "The text is not valid UTF-8.");
    std::wstring result(length, L'\0');
    MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), length);
    return result;
}

inline std::string utf8(const std::wstring& value)
{
    if (value.empty()) return {};
    int length = WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), nullptr, 0, nullptr, nullptr);
    require(length > 0, "The document contains invalid Unicode text.");
    std::string result(length, '\0');
    WideCharToMultiByte(CP_UTF8, WC_ERR_INVALID_CHARS, value.data(), static_cast<int>(value.size()), result.data(), length, nullptr, nullptr);
    return result;
}

inline std::string normalize(const std::string& value)
{
    std::string result;
    result.reserve(value.size());
    for (size_t i = 0; i < value.size(); ++i)
    {
        if (value[i] == '\r')
        {
            result += '\n';
            if (i + 1 < value.size() && value[i + 1] == '\n') ++i;
        }
        else result += value[i];
    }
    return result;
}

inline bool starts(const std::string& value, const std::string& prefix)
{
    return value.compare(0, prefix.size(), prefix) == 0;
}

inline const std::map<std::string, std::string>& boms()
{
    static const std::map<std::string, std::string> result = {
        {"UTF-8-BOM", "\xef\xbb\xbf"}, {"UTF-16LE", "\xff\xfe"}, {"UTF-16BE", "\xfe\xff"}};
    return result;
}

inline json decode(const std::string& bytes, std::string encoding = "")
{
    require(bytes.size() <= maxFile, "This file exceeds the 8 MB editing limit.");
    const bool explicitEncoding = !encoding.empty();
    if (!explicitEncoding)
    {
        require(!starts(bytes, std::string("\xff\xfe\0\0", 4)) && !starts(bytes, std::string("\0\0\xfe\xff", 4)), "UTF-32 is not supported. Convert this file to UTF-8 first.");
        encoding = starts(bytes, "\xef\xbb\xbf") ? "UTF-8-BOM" : starts(bytes, "\xff\xfe") ? "UTF-16LE" : starts(bytes, "\xfe\xff") ? "UTF-16BE" : "UTF-8";
    }
    size_t offset = 0;
    const std::string bom = encoding == "UTF-8" ? "\xef\xbb\xbf" : boms().count(encoding) ? boms().at(encoding) : "";
    if (!bom.empty() && starts(bytes, bom)) offset = bom.size();
    std::string data = bytes.substr(offset), text;
    if (encoding == "UTF-8" || encoding == "UTF-8-BOM")
    {
        try { wide(data); text = data; }
        catch (const std::exception&)
        {
            if (explicitEncoding || offset) throw std::runtime_error("This file is not valid UTF-8.");
            encoding = "windows-1252";
        }
    }
    if (encoding == "UTF-16LE" || encoding == "UTF-16BE")
    {
        require(data.size() % 2 == 0, "This file is not valid UTF-16.");
        std::wstring converted;
        for (size_t i = 0; i < data.size(); i += 2)
        {
            unsigned a = static_cast<unsigned char>(data[i]), b = static_cast<unsigned char>(data[i + 1]);
            converted += static_cast<wchar_t>(encoding == "UTF-16LE" ? a | (b << 8) : (a << 8) | b);
        }
        text = utf8(converted);
    }
    else if (encoding == "windows-1252" || encoding == "ISO-8859-1" || encoding == "US-ASCII")
    {
        std::wstring converted;
        for (unsigned char byte : data)
        {
            if (encoding == "US-ASCII") require(byte <= 127, "This file is not valid ASCII.");
            if (encoding == "windows-1252")
            {
                require(byte != 0x81 && byte != 0x8d && byte != 0x8f && byte != 0x90 && byte != 0x9d, "This file contains invalid Windows-1252 bytes.");
                wchar_t character = 0;
                char original = static_cast<char>(byte);
                require(MultiByteToWideChar(1252, 0, &original, 1, &character, 1) == 1, "Invalid Windows-1252 data.");
                converted += character;
            }
            else converted += static_cast<wchar_t>(byte);
        }
        text = utf8(converted);
    }
    else require(encoding == "UTF-8" || encoding == "UTF-8-BOM", "Unsupported text encoding.");
    require(text.find('\0') == std::string::npos, "This appears to be a binary file or UTF-16 without a byte order mark.");
    size_t crlf = 0, lf = 0, cr = 0;
    for (size_t i = 0; i < text.size(); ++i)
    {
        if (text[i] == '\r')
        {
            if (i + 1 < text.size() && text[i + 1] == '\n') { ++crlf; ++i; }
            else ++cr;
        }
        else if (text[i] == '\n') ++lf;
    }
    const std::string eol = crlf && crlf >= lf && crlf >= cr ? "CRLF" : cr > lf ? "CR" : "LF";
    return {{"text", normalize(text)}, {"encoding", encoding}, {"eol", eol}, {"mixedEol", int(crlf > 0) + int(lf > 0) + int(cr > 0) > 1}};
}

inline std::string encode(std::string text, const std::string& encoding, const std::string& eol)
{
    require(eol == "LF" || eol == "CRLF" || eol == "CR", "Unsupported line ending.");
    text = normalize(text);
    if (eol != "LF")
    {
        std::string converted;
        for (char ch : text) converted += ch == '\n' ? (eol == "CRLF" ? "\r\n" : "\r") : std::string(1, ch);
        text.swap(converted);
    }
    const auto converted = wide(text);
    std::string output = boms().count(encoding) ? boms().at(encoding) : "";
    if (encoding == "UTF-8" || encoding == "UTF-8-BOM") output += text;
    else if (encoding == "UTF-16LE" || encoding == "UTF-16BE")
    {
        for (wchar_t ch : converted)
        {
            char low = static_cast<char>(ch & 255), high = static_cast<char>((ch >> 8) & 255);
            if (encoding == "UTF-16LE") { output += low; output += high; }
            else { output += high; output += low; }
        }
    }
    else if (encoding == "windows-1252")
    {
        for (wchar_t ch : converted)
        {
            BOOL usedDefault = FALSE;
            char byte;
            require(WideCharToMultiByte(1252, WC_NO_BEST_FIT_CHARS, &ch, 1, &byte, 1, nullptr, &usedDefault) == 1 && !usedDefault,
                    "Some characters cannot be saved as Windows-1252. Choose UTF-8.");
            unsigned char code = static_cast<unsigned char>(byte);
            require(code != 0x81 && code != 0x8d && code != 0x8f && code != 0x90 && code != 0x9d, "Undefined Windows-1252 character. Choose UTF-8.");
            output += byte;
        }
    }
    else if (encoding == "ISO-8859-1" || encoding == "US-ASCII")
    {
        for (wchar_t ch : converted)
        {
            require(ch <= (encoding == "US-ASCII" ? 127 : 255), "Some characters cannot be saved in this encoding. Choose UTF-8.");
            output += static_cast<char>(ch);
        }
    }
    else throw std::runtime_error("Unsupported text encoding.");
    require(output.size() <= maxFile, "The encoded document exceeds the 8 MB file limit.");
    return output;
}

inline std::string readFile(const fs::path& path, size_t limit = maxFile)
{
    require(fs::is_regular_file(path), "This path is not a regular file.");
    require(fs::file_size(path) <= limit, "This file exceeds the editing/search size limit.");
    std::ifstream input(path, std::ios::binary);
    require(bool(input), "The local file could not be opened.");
    std::string data;
    char buffer[65536];
    while (input)
    {
        input.read(buffer, sizeof(buffer));
        data.append(buffer, static_cast<size_t>(input.gcount()));
        require(data.size() <= limit, "The file changed while being read.");
    }
    require(input.eof(), "The local file could not be read.");
    return data;
}

inline void atomicWrite(const fs::path& target, const std::string& data)
{
    const auto temporary = target.parent_path() / (L".anotep-" + std::to_wstring(GetCurrentProcessId()) + L"-" + std::to_wstring(GetTickCount64()) + L".tmp");
    HANDLE file = CreateFileW(temporary.c_str(), GENERIC_WRITE, 0, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL | FILE_FLAG_WRITE_THROUGH, nullptr);
    require(file != INVALID_HANDLE_VALUE, "The destination folder is not writable. Your text is still open.");
    DWORD written = 0;
    bool ok = WriteFile(file, data.data(), static_cast<DWORD>(data.size()), &written, nullptr) && written == data.size() && FlushFileBuffers(file);
    CloseHandle(file);
    if (ok)
    {
        if (fs::exists(target)) ok = ReplaceFileW(target.c_str(), temporary.c_str(), nullptr, 0, nullptr, nullptr) != FALSE;
        else ok = MoveFileExW(temporary.c_str(), target.c_str(), MOVEFILE_WRITE_THROUGH) != FALSE;
    }
    if (!ok)
    {
        DeleteFileW(temporary.c_str());
        throw std::runtime_error("The file could not be saved. Your text is still open; the previous file was preserved.");
    }
}

inline std::string fingerprint(const std::string& data)
{
    HCRYPTPROV provider = 0;
    HCRYPTHASH hash = 0;
    require(CryptAcquireContextW(&provider, nullptr, nullptr, PROV_RSA_AES, CRYPT_VERIFYCONTEXT), "SHA-256 provider unavailable.");
    bool ok = CryptCreateHash(provider, CALG_SHA_256, 0, 0, &hash) != FALSE;
    if (ok) ok = CryptHashData(hash, reinterpret_cast<const BYTE*>(data.data()), static_cast<DWORD>(data.size()), 0) != FALSE;
    BYTE bytes[32]{};
    DWORD size = sizeof(bytes);
    if (ok) ok = CryptGetHashParam(hash, HP_HASHVAL, bytes, &size, 0) != FALSE;
    if (hash) CryptDestroyHash(hash);
    CryptReleaseContext(provider, 0);
    require(ok, "SHA-256 calculation failed.");
    std::string result;
    for (BYTE byte : bytes) { result += "0123456789abcdef"[byte >> 4]; result += "0123456789abcdef"[byte & 15]; }
    return result;
}

inline fs::path checkedLocal(fs::path path)
{
    require(path.wstring().find(L'\0') == std::wstring::npos, "Only ordinary local files can be opened.");
    path = fs::absolute(path).lexically_normal();
    const auto value = path.wstring();
    require(value.size() >= 3 && iswalpha(value[0]) && value[1] == L':' && (value[2] == L'\\' || value[2] == L'/'), "Only local drive paths can be opened.");
    require(value.find(L'\0') == std::wstring::npos && value.find(L':', 2) == std::wstring::npos, "Only ordinary local files can be opened.");
    require(GetDriveTypeW(path.root_path().c_str()) != DRIVE_REMOTE, "Network drives are not available in offline mode.");
    if (fs::exists(path))
    {
        path = fs::canonical(path);
        const auto canonical = path.wstring();
        require(canonical.size() >= 3 && canonical[1] == L':' && GetDriveTypeW(path.root_path().c_str()) != DRIVE_REMOTE,
                "Network paths are not available in offline mode.");
    }
    return path;
}

inline std::string uri(const fs::path& path)
{
    auto value = utf8(path.generic_wstring());
    std::string output = "file:///";
    for (unsigned char ch : value)
    {
        if (isalnum(ch) || ch == '/' || ch == ':' || ch == '-' || ch == '.' || ch == '_' || ch == '~') output += static_cast<char>(ch);
        else { output += '%'; output += "0123456789ABCDEF"[ch >> 4]; output += "0123456789ABCDEF"[ch & 15]; }
    }
    return output;
}

inline fs::path pathFromUri(const std::string& value)
{
    require(starts(value, "file:///"), "Only local files can be opened.");
    std::string decoded;
    const auto hex = [](char ch) -> int { if (ch >= '0' && ch <= '9') return ch - '0'; if (ch >= 'a' && ch <= 'f') return ch - 'a' + 10; if (ch >= 'A' && ch <= 'F') return ch - 'A' + 10; return -1; };
    for (size_t i = 8; i < value.size(); ++i)
    {
        if (value[i] == '%')
        {
            require(i + 2 < value.size() && hex(value[i + 1]) >= 0 && hex(value[i + 2]) >= 0, "Invalid local file URI.");
            decoded += static_cast<char>((hex(value[i + 1]) << 4) | hex(value[i + 2])); i += 2;
        }
        else
        {
            require(value[i] != '?' && value[i] != '#', "Invalid local file URI.");
            decoded += value[i];
        }
    }
    return checkedLocal(fs::path(wide(decoded)));
}

inline json opened(const std::string& value, const std::string& encoding = "", int line = 0)
{
    const auto path = pathFromUri(value);
    const auto data = readFile(path);
    auto result = decode(data, encoding);
    result.update({{"uri", uri(path)}, {"name", utf8(path.filename().wstring())}, {"fingerprint", fingerprint(data)}, {"line", line}, {"reload", !encoding.empty()}});
    return result;
}

inline void validateWorkspace(const json& state)
{
    require(state.is_object() && state.contains("documents") && state["documents"].is_array() && state["documents"].size() <= 30, "A workspace can contain at most 30 tabs.");
    require(!state.contains("settings") || state["settings"].is_object(), "The recovery settings are invalid.");
    if (state.contains("settings") && state["settings"].contains("folderUri"))
        require(state["settings"]["folderUri"].is_string(), "The recovery folder is invalid.");
    require(state.dump().size() <= maxSession, "Recovery storage is limited to 32 MB. Save and close some tabs.");
}

inline bool within(const fs::path& root, const fs::path& target)
{
    auto r = root.begin(), t = target.begin();
    for (; r != root.end() && t != target.end(); ++r, ++t)
        if (_wcsicmp(r->c_str(), t->c_str()) != 0) return false;
    return r == root.end();
}

inline std::pair<fs::path, fs::path> directory(const std::string& rootUri, const std::string& value)
{
    require(!rootUri.empty(), "Choose a local folder first.");
    auto root = fs::canonical(pathFromUri(rootUri)), target = fs::canonical(pathFromUri(value));
    require(within(root, target) && fs::is_directory(target), "Choose this folder before browsing it.");
    return {root, target};
}

inline bool reparse(const fs::path& path)
{
    const auto attributes = GetFileAttributesW(path.c_str());
    return attributes == INVALID_FILE_ATTRIBUTES || (attributes & FILE_ATTRIBUTE_REPARSE_POINT);
}

inline json listing(const std::string& root, const std::string& value)
{
    const auto target = directory(root, value).second;
    json entries = json::array();
    bool truncated = false;
    for (const auto& entry : fs::directory_iterator(target, fs::directory_options::skip_permission_denied))
    {
        if (reparse(entry.path()) || (!entry.is_directory() && !entry.is_regular_file())) continue;
        if (entries.size() >= 1000) { truncated = true; break; }
        entries.push_back({{"uri", uri(entry.path())}, {"name", utf8(entry.path().filename().wstring())}, {"directory", entry.is_directory()}});
    }
    std::sort(entries.begin(), entries.end(), [](const json& a, const json& b) {
        if (a["directory"] != b["directory"]) return a["directory"].get<bool>();
        return _wcsicmp(wide(a["name"].get<std::string>()).c_str(), wide(b["name"].get<std::string>()).c_str()) < 0;
    });
    return {{"uri", uri(target)}, {"entries", entries}, {"truncated", truncated}};
}

inline json candidates(const std::string& rootUri)
{
    const auto root = directory(rootUri, rootUri).first;
    std::vector<fs::path> folders{root};
    json files = json::array();
    size_t count = 0, skipped = 0, bytes = 0, visited = 0;
    bool limited = false;
    while (!folders.empty())
    {
        auto path = folders.back(); folders.pop_back();
        if (++visited > 200) { limited = true; break; }
        try
        {
            for (const auto& entry : fs::directory_iterator(path, fs::directory_options::skip_permission_denied))
            {
                if (reparse(entry.path())) { ++skipped; continue; }
                if (entry.is_directory()) { if (folders.size() < 200) folders.push_back(entry.path()); else limited = true; continue; }
                if (!entry.is_regular_file()) continue;
                if (count >= 500 || bytes >= 16 * 1024 * 1024) { limited = true; break; }
                ++count;
                try
                {
                    const auto data = readFile(entry.path(), 1024 * 1024);
                    if (bytes + data.size() > 16 * 1024 * 1024) { limited = true; break; }
                    bytes += data.size();
                    files.push_back({{"uri", uri(entry.path())}, {"name", utf8(entry.path().filename().wstring())}, {"text", decode(data)["text"]}});
                }
                catch (const std::exception&) { ++skipped; }
            }
        }
        catch (const std::exception&) { ++skipped; }
        if (count >= 500 || bytes >= 16 * 1024 * 1024) { limited = true; break; }
    }
    return {{"candidates", files}, {"files", count}, {"skipped", skipped}, {"limited", limited}};
}
}
