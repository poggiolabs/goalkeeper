#!/bin/sh
set -eu

api_url="${GOALKEEPER_API_URL:-}"
docs_url="${GOALKEEPER_DOCS_URL:-}"
output_path="${GOALKEEPER_RUNTIME_CONFIG_PATH:-/usr/share/nginx/html/runtime-config.js}"

validate_url() {
    name="$1"
    value="$2"
    if [ -z "$value" ]; then
        return
    fi
    case "$value" in
        http://*|https://*) ;;
        *)
            echo "$name must be an absolute HTTP or HTTPS URL" >&2
            exit 1
            ;;
    esac
    if printf '%s' "$value" | grep -q '[[:space:]\\"]'; then
        echo "$name must not contain whitespace, quotes, or backslashes" >&2
        exit 1
    fi
}

validate_url GOALKEEPER_API_URL "$api_url"
validate_url GOALKEEPER_DOCS_URL "$docs_url"

encoded_api_url="$(printf '%s' "$api_url" | base64 | tr -d '\n')"
encoded_docs_url="$(printf '%s' "$docs_url" | base64 | tr -d '\n')"
printf 'window.__GOALKEEPER_CONFIG__ = Object.freeze({"apiBaseUrl":atob("%s"),"docsUrl":atob("%s")});\n' \
    "$encoded_api_url" "$encoded_docs_url" > "$output_path"
