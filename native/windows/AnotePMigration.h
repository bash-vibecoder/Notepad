// AnoteP native Windows migration, November 27, 2026.
// SPDX-License-Identifier: GPL-3.0-or-later
#pragma once
#include <filesystem>
#include <fstream>
#include <iomanip>
#include "json/json.hpp"

inline std::string anotepXmlEscape(const std::string& value)
{
	std::string result;
	for (char ch : value)
	{
		switch (ch)
		{
			case '&': result += "&amp;"; break;
			case '<': result += "&lt;"; break;
			case '>': result += "&gt;"; break;
			case '"': result += "&quot;"; break;
			default: result += ch;
		}
	}
	return result;
}

inline void migrateAnotePWorkspace()
{
	// Export recovery copies only. Never save over an original document, existing
	// native session, or an earlier recovered copy. Keep workspace.json untouched.
	try {
		wchar_t appdata[MAX_PATH]{};
		if (::GetEnvironmentVariableW(L"APPDATA", appdata, MAX_PATH) == 0)
			return;
		namespace fs = std::filesystem;
		const fs::path root = fs::path(appdata) / L"AnoteP";
		const fs::path native = root / L"Native";
		fs::create_directories(native);
		const fs::path original = root / L"workspace.json";
		const fs::path recovered = native / L"Recovered";
		if (!fs::exists(original) || fs::exists(recovered) || fs::exists(native / L"session.xml"))
			return;
		if (fs::file_size(original) > 32 * 1024 * 1024)
			return;
		std::ifstream input(original, std::ios::binary);
		const auto state = nlohmann::json::parse(input);
		if (!state.contains("documents") || !state["documents"].is_array() || state["documents"].size() > 30)
			return;
		const fs::path temporary = native / L"Recovered.tmp";
		if (fs::exists(temporary))
			return;
		fs::create_directories(temporary);
		std::string files;
		std::string locations = "AnoteP recovered workspace\r\n\r\nThese are recovered copies; originals were not overwritten.\r\nUse Save As to save back to an original path.\r\n\r\n";
		int index = 0;
		for (const auto& document : state["documents"])
		{
			if (!document.contains("text") || !document["text"].is_string())
				continue;
			++index;
			std::string name = document.value("name", "document.txt");
			for (char& ch : name)
			{
				if (static_cast<unsigned char>(ch) < 32 || std::string("<>:\"/\\|?*").find(ch) != std::string::npos)
					ch = '_';
			}
			if (name.size() > 100)
				name = "document.txt";
			while (!name.empty() && (name.back() == '.' || name.back() == ' '))
				name.pop_back();
			name = std::to_string(index) + "-" + (name.empty() ? "document.txt" : name);
			const fs::path relative = std::u8string(name.begin(), name.end());
			std::ofstream output(temporary / relative, std::ios::binary);
			output.exceptions(std::ios::failbit | std::ios::badbit);
			output << "\xEF\xBB\xBF" << document["text"].get<std::string>();
			output.close();
			locations += name + "\r\nOriginal: " + document.value("uri", "(unsaved tab)") + "\r\n\r\n";
			const auto file = (recovered / relative).u8string();
			files += "<File filename=\"" + anotepXmlEscape(std::string(file.begin(), file.end())) + "\" />\n";
		}
		fs::copy_file(original, temporary / L"workspace.json");
		std::ofstream description(temporary / L"READ-ME.txt", std::ios::binary);
		description.exceptions(std::ios::failbit | std::ios::badbit);
		description << locations;
		description.close();
		fs::rename(temporary, recovered);
		std::ofstream session(native / L"session.xml", std::ios::binary);
		session << "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<NotepadPlus><Session activeView=\"0\"><mainView activeIndex=\"0\">\n"
			<< files << "</mainView><subView activeIndex=\"0\"/></Session></NotepadPlus>\n";
	}
	catch (const std::exception&)
	{
		// The original workspace remains intact even if migration cannot finish.
	}
}
