// SPDX-License-Identifier: MIT
// Read old sessions and recovery copies without changing or deleting them.
#pragma once
#include <msxml6.h>
#include <wrl.h>
#include "core.h"

namespace anotep
{
using Microsoft::WRL::ComPtr;

inline std::wstring attribute(IXMLDOMNode* node, const wchar_t* name)
{
    ComPtr<IXMLDOMNamedNodeMap> attributes;
    if (FAILED(node->get_attributes(&attributes)) || !attributes) return {};
    ComPtr<IXMLDOMNode> item;
    BSTR key = SysAllocString(name);
    attributes->getNamedItem(key, &item);
    SysFreeString(key);
    if (!item) return {};
    VARIANT value;
    VariantInit(&value);
    item->get_nodeValue(&value);
    std::wstring result = value.vt == VT_BSTR && value.bstrVal ? value.bstrVal : L"";
    VariantClear(&value);
    return result;
}

inline json importNative(json state, const fs::path& profile, const fs::path& oldProfile)
{
    const auto marker = profile / L"native-session-import.json";
    if (fs::exists(marker)) return state;
    const auto source = oldProfile / L"session.xml";
    if (!fs::is_regular_file(source)) return state;
    checkedLocal(source);
    require(fs::file_size(source) <= maxSession, "The previous native session is too large to import automatically.");
    ComPtr<IXMLDOMDocument2> xml;
    require(SUCCEEDED(CoCreateInstance(__uuidof(DOMDocument60), nullptr, CLSCTX_INPROC_SERVER, IID_PPV_ARGS(&xml))), "Windows XML reader is unavailable.");
    xml->put_async(VARIANT_FALSE);
    xml->put_validateOnParse(VARIANT_FALSE);
    xml->put_resolveExternals(VARIANT_FALSE);
    VARIANT forbid;
    VariantInit(&forbid); forbid.vt = VT_BOOL; forbid.boolVal = VARIANT_TRUE;
    BSTR property = SysAllocString(L"ProhibitDTD");
    xml->setProperty(property, forbid);
    SysFreeString(property);
    VARIANT input;
    VariantInit(&input); input.vt = VT_BSTR; input.bstrVal = SysAllocString(source.c_str());
    VARIANT_BOOL loaded = VARIANT_FALSE;
    xml->load(input, &loaded);
    VariantClear(&input);
    require(loaded == VARIANT_TRUE, "The previous native session could not be read; it has not been changed.");
    ComPtr<IXMLDOMNodeList> nodes;
    BSTR query = SysAllocString(L"/NotepadPlus/Session/*/File");
    xml->selectNodes(query, &nodes);
    SysFreeString(query);
    if (!state.contains("documents")) state["documents"] = json::array();
    if (!state.contains("settings")) state["settings"] = json::object();
    json report = {{"source", utf8(source.wstring())}, {"imported", 0}, {"retainedInOriginalSession", json::array()}};
    long count = 0;
    if (nodes) nodes->get_length(&count);
    std::vector<std::wstring> seen;
    for (long index = 0; index < count; ++index)
    {
        ComPtr<IXMLDOMNode> node;
        nodes->get_item(index, &node);
        const auto original = attribute(node.Get(), L"filename");
        const auto backup = attribute(node.Get(), L"backupFilePath");
        const auto identity = backup.empty() ? original : backup;
        if (std::find(seen.begin(), seen.end(), identity) != seen.end()) continue;
        seen.push_back(identity);
        const auto documentId = "native-import-" + fingerprint(utf8(identity));
        if (std::any_of(state["documents"].begin(), state["documents"].end(), [&](const json& document) { return document.value("id", "") == documentId; })) continue;
        try
        {
            require(state["documents"].size() < 30, "Tab limit reached.");
            fs::path textPath = backup.empty() ? fs::path(original) : fs::path(backup);
            textPath = checkedLocal(textPath);
            auto document = decode(readFile(textPath));
            bool originalIsLocalFile = false;
            fs::path originalPath;
            if (original.size() > 2 && original[1] == L':')
            {
                originalPath = checkedLocal(fs::path(original));
                originalIsLocalFile = fs::is_regular_file(originalPath);
            }
            document.update({{"id", documentId},
                {"name", utf8(originalIsLocalFile ? originalPath.filename().wstring() : original)},
                {"uri", originalIsLocalFile ? uri(originalPath) : ""}, {"dirty", !backup.empty()},
                {"fingerprint", originalIsLocalFile ? fingerprint(readFile(originalPath)) : ""},
                {"autoLanguage", true}, {"cursor", {{"line", 0}, {"ch", 0}}}, {"bookmarks", json::array()}});
            auto tentative = state;
            tentative["documents"].push_back(document);
            validateWorkspace(tentative);
            state = std::move(tentative);
            state["activeId"] = document["id"];
            report["imported"] = report["imported"].get<int>() + 1;
        }
        catch (const std::exception&)
        {
            report["retainedInOriginalSession"].push_back({{"filename", utf8(original)}, {"backupFilePath", utf8(backup)}});
        }
    }
    fs::create_directories(profile);
    const auto workspace = profile / L"workspace.json";
    if (fs::exists(workspace) && !fs::exists(profile / L"workspace-before-native-import.json"))
        fs::copy_file(workspace, profile / L"workspace-before-native-import.json");
    validateWorkspace(state);
    atomicWrite(workspace, state.dump());
    atomicWrite(marker, report.dump(2));
    return state;
}
}
