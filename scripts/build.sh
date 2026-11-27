#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
python3 scripts/sync-version.py
ANOTEP_VERSION="$(cat VERSION)"

# Offline build: supply these jars or reuse the installed Android tools.
ANOTEP_ANDROID_JAR="${ANOTEP_ANDROID_JAR:-/root/p1/.tools/android.jar}"
ANOTEP_RESOURCE_JAR="${ANOTEP_RESOURCE_JAR:-/root/p1/.tools/android-34.jar}"
ANOTEP_R8_JAR="${ANOTEP_R8_JAR:-/root/p1/.tools/r8.jar}"
for tool in java javac jar aapt zipalign apksigner keytool python3 node; do
    command -v "$tool" >/dev/null || { echo "Missing build tool: $tool" >&2; exit 1; }
done
for input in "$ANOTEP_ANDROID_JAR" "$ANOTEP_RESOURCE_JAR" "$ANOTEP_R8_JAR"; do
    test -f "$input" || { echo "Missing installed build dependency: $input" >&2; exit 1; }
done

mkdir -p build/generated build/classes build/dex build/tests dist .tools
find build/generated build/classes build/dex build/tests -type f -delete
ANOTEP_MANIFEST=app/src/main/AndroidManifest.xml
ANOTEP_APK="dist/AnoteP-${ANOTEP_VERSION}-android.apk"
if [[ "${ANOTEP_DEBUG:-0}" == 1 ]]; then
    python3 - <<'PY'
from pathlib import Path
manifest=Path('app/src/main/AndroidManifest.xml').read_text().replace('<application ', '<application android:debuggable="true" ', 1)
Path('build/debug').mkdir(exist_ok=True)
Path('build/debug/AndroidManifest.xml').write_text(manifest)
PY
    ANOTEP_MANIFEST=build/debug/AndroidManifest.xml
    ANOTEP_APK=build/AnoteP-debug.apk
fi
node --check app/src/main/assets/app.js
node tests/editor-core.test.js
javac --release 8 -d build/tests app/src/main/java/app/anotep/editor/EditorCore.java tests/app/anotep/editor/EditorCoreTest.java
java -cp build/tests app.anotep.editor.EditorCoreTest

aapt package -f -m -M "$ANOTEP_MANIFEST" -S app/src/main/res -A app/src/main/assets -I "$ANOTEP_RESOURCE_JAR" -J build/generated
find app/src/main/java build/generated -name '*.java' -print > build/sources.txt
javac -encoding UTF-8 --release 8 -classpath "$ANOTEP_ANDROID_JAR" -d build/classes @build/sources.txt
jar cf build/classes.jar -C build/classes .
java -cp "$ANOTEP_R8_JAR" com.android.tools.r8.D8 --release --min-api 26 --lib "$ANOTEP_ANDROID_JAR" --output build/dex build/classes.jar
aapt package -f -M "$ANOTEP_MANIFEST" -S app/src/main/res -A app/src/main/assets -I "$ANOTEP_RESOURCE_JAR" -F build/unsigned.apk
python3 - <<'PY'
from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
with ZipFile('build/unsigned.apk', 'a', ZIP_DEFLATED) as apk:
    for dex in sorted(Path('build/dex').glob('*.dex')):
        apk.write(dex, dex.name)
PY
zipalign -f -p 4 build/unsigned.apk build/aligned.apk
if ! test -f .tools/anotep-dev.jks; then
    keytool -genkeypair -keystore .tools/anotep-dev.jks -storepass android -keypass android -alias anotep -keyalg RSA -keysize 3072 -validity 10000 -dname 'CN=AnoteP Development' -noprompt
fi
apksigner sign --ks .tools/anotep-dev.jks --ks-key-alias anotep --ks-pass pass:android --key-pass pass:android --out "$ANOTEP_APK" build/aligned.apk
apksigner verify --verbose "$ANOTEP_APK"
zipalign -c -p 4 "$ANOTEP_APK"
python3 scripts/verify_apk.py "$ANOTEP_APK"
python3 - "$ANOTEP_APK" <<'PY'
import hashlib, sys
from pathlib import Path
p = Path(sys.argv[1])
assert p.stat().st_size < 1024 * 1024, 'APK exceeds the 1 MiB download budget'
Path(str(p)+'.sha256').write_text(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n')
PY
ls -lh "$ANOTEP_APK"
