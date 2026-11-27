// Test program only; never included in an application package.
#define UNICODE
#define _UNICODE
#define NOMINMAX
#include "core.h"
#include <iostream>
using namespace anotep;
int main()
{
    int checks = 0;
    for (const std::string encoding : {"UTF-8", "UTF-8-BOM", "UTF-16LE", "UTF-16BE", "windows-1252", "ISO-8859-1", "US-ASCII"})
        for (const std::string eol : {"LF", "CRLF", "CR"})
        {
            const std::string text = starts(encoding, "UTF") ? u8"penguin 🐧\nsecond\n" : "hello\nsecond\n";
            auto bytes = encode(text, encoding, eol);
            auto decoded = decode(bytes, encoding);
            require(decoded["text"] == text && decoded["eol"] == eol, "Encoding round trip failed.");
            require(encode(decoded["text"], decoded["encoding"], decoded["eol"]) == bytes, "File fidelity failed.");
            ++checks;
        }
    require(decode(std::string("\x93hi\x94"))["text"] == u8"“hi”", "Windows-1252 fallback failed."); ++checks;
    require(encode(u8"€", "windows-1252", "LF") == std::string("\x80"), "Windows-1252 encode failed."); ++checks;
    require(fingerprint("abc") == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", "SHA-256 mismatch."); ++checks;
    for (const std::string value : {"https://example.com/file", "file://server/share/file", "file:///C:/file?query", "file:///C:/file#fragment", "file:///C:/a%00b"})
    {
        bool rejected = false;
        try { pathFromUri(value); } catch (...) { rejected = true; }
        require(rejected, "Remote/invalid URI accepted."); ++checks;
    }
    const fs::path unicodePath = fs::path(wide(u8"C:\\AnoteP-test-🐧 #%.txt"));
    require(pathFromUri(uri(unicodePath)) == checkedLocal(unicodePath), "Unicode URI round trip failed."); ++checks;
    std::cout << "Windows local-file core: " << checks << " checks passed.\n";
}
