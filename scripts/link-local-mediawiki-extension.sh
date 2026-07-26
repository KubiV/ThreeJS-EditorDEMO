#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
project_root="$(cd -- "$script_dir/.." && pwd)"
source_path="$project_root/extensions/ThreeDViewer"
link_path="$project_root/mediawiki-1.41.1/extensions/ThreeDViewer"
relative_target="../../extensions/ThreeDViewer"

if [ ! -d "$source_path" ]; then
	echo "Chybí verzované rozšíření: $source_path" >&2
	exit 1
fi

if [ -L "$link_path" ]; then
	if [ "$(readlink "$link_path")" = "$relative_target" ]; then
		echo "Odkaz na ThreeDViewer již existuje."
		exit 0
	fi
	echo "Cílová cesta už obsahuje jiný symbolický odkaz: $link_path" >&2
	exit 1
fi

if [ -e "$link_path" ]; then
	echo "Cílová cesta už obsahuje soubor nebo složku: $link_path" >&2
	echo "Nejprve ji zazálohujte nebo přesuňte mimo extensions/." >&2
	exit 1
fi

mkdir -p "$(dirname -- "$link_path")"
ln -s "$relative_target" "$link_path"
echo "Vytvořen odkaz: $link_path -> $relative_target"
