#!/usr/bin/env bash
# Install a uniquely named diagnostic build, without restarting KWin.
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
plugin="$root/native/build/plugins/kwin/effects/plugins/focusglass.so"
if pgrep -x focusglass >/dev/null; then
    echo "Сначала закройте FocusGlass, чтобы он не управлял тестовым эффектом." >&2
    exit 1
fi
if [[ ! -f "$plugin" ]]; then
    echo "Диагностическая сборка плагина отсутствует: $plugin" >&2
    exit 1
fi
id="focusglass_probe_$(sha256sum "$plugin" | cut -c1-12)"
# Separate filename also avoids Qt reusing the old mapped plugin library.
sudo install -Dm755 "$plugin" "/usr/lib/qt6/plugins/kwin/effects/plugins/$id.so"
while IFS= read -r effect; do
    if [[ "$effect" == "focusglass" || "$effect" == focusglass_probe_* ]]; then
        qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.unloadEffect "$effect"
    fi
done < <(qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadedEffects)
loaded="$(qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect "$id")"
if [[ "$loaded" != "true" ]]; then
    echo "KWin не загрузил диагностический плагин: $loaded" >&2
    qdbus6 org.kde.KWin /Effects org.kde.kwin.Effects.loadEffect focusglass || true
    exit 1
fi
echo "Сейчас будет трёхсекундный тест. Изображения рабочего стола не сохраняются."
python3 "$root/scripts/linux/diagnose-kwin.py"
