#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR="/var/www/html/allstar_view"
WEB_USER="www-data"
WEB_GROUP="www-data"
CONFIG_FILE="$APP_DIR/config.ini"
CONFIG_EXAMPLE="$APP_DIR/config.ini.example"
HELPER="$APP_DIR/bin/allstar-view-read.sh"
SUDOERS_FILE="/etc/sudoers.d/allstar-view-read"
APACHE_CONF_NAME="allstar-view-security"
APACHE_CONF="/etc/apache2/conf-available/${APACHE_CONF_NAME}.conf"
QUIET_LOG="${QUIET_COMMAND_LOG:-/tmp/allstar-view-setup.log}"
SKIP_APT="${ALLSTAR_VIEW_SKIP_APT:-0}"
ACTION="normal"
case "${1:-}" in
    --set-admin-password|--auth) ACTION="set-password" ;;
    --enable-auth) ACTION="enable-auth" ;;
    --disable-auth) ACTION="disable-auth" ;;
    --help|-h)
        echo "Usage:"
        echo "  sudo $APP_DIR/setup_allstar_view.sh"
        echo "  sudo $APP_DIR/setup_allstar_view.sh --set-admin-password"
        echo "  sudo $APP_DIR/setup_allstar_view.sh --enable-auth"
        echo "  sudo $APP_DIR/setup_allstar_view.sh --disable-auth"
        echo
        echo "--set-admin-password prompts twice, saves a password hash, and enables login."
        echo "--enable-auth re-enables login using the saved password hash."
        echo "--disable-auth disables login but preserves the saved password hash."
        echo "Set ALLSTAR_VIEW_SKIP_APT=1 to skip apt package installation."
        exit 0 ;;
    "") ;;
    *) echo "[ERROR] Unknown option: $1" >&2; exit 1 ;;
esac
fail(){ echo "[ERROR] $*" >&2; exit 1; }
[[ ${EUID} -eq 0 ]] || fail "Run this script as root."
[[ -d "$APP_DIR" ]] || fail "Application directory not found: $APP_DIR"
: > "$QUIET_LOG"; chmod 0600 "$QUIET_LOG" 2>/dev/null || true

on_error() {
    local exit_code="$?"
    local line_no="${1:-unknown}"

    trap - ERR

    echo "[ERROR] AllStar View setup failed near line ${line_no} (exit ${exit_code})." >&2
    if [[ -s "$QUIET_LOG" ]]; then
        echo "[ERROR] Last setup log lines:" >&2
        tail -n 60 "$QUIET_LOG" >&2 || true
    fi
    exit "$exit_code"
}

trap 'on_error $LINENO' ERR

run_quiet_command() {
    local label="$1"
    shift

    {
        echo
        echo "===== ${label} ====="
        printf 'Command:'
        printf ' %q' "$@"
        echo
    } >> "$QUIET_LOG"

    if ! "$@" >> "$QUIET_LOG" 2>&1; then
        echo "[ERROR] ${label} failed." >&2
        echo "[ERROR] Last setup log lines:" >&2
        tail -n 60 "$QUIET_LOG" >&2 || true
        exit 1
    fi
}

required=(
    VERSION config.ini.example setup_allstar_view.sh
    public/index.php public/login.php public/logout.php
    public/assets/app-shell.css public/assets/header.js public/assets/allstar-view.css
    public/assets/allstar-view.js public/assets/audio-alerts.js
    api/local.php api/downstream.php api/echolink.php
    src/CacheMaintenance.php src/Downstream.php src/EchoLink.php src/Monitor.php src/NodeIdentity.php
    app/Support/Config.php app/Support/AppSession.php app/Support/AppAuth.php app/Support/AppCsrf.php
    bin/allstar-view-read.sh
)
for file in "${required[@]}"; do [[ -f "$APP_DIR/$file" ]] || fail "Missing required file: $APP_DIR/$file"; done

update_auth_config() {
    local enabled="$1"
    local user_value="$2"
    local hash_value="$3"

    ALLSTAR_VIEW_AUTH_ENABLED_VALUE="$enabled" \
    ALLSTAR_VIEW_ADMIN_USER_VALUE="$user_value" \
    ALLSTAR_VIEW_ADMIN_HASH_VALUE="$hash_value" \
    php -r '
$path = $argv[1];
$lines = file($path, FILE_IGNORE_NEW_LINES);
if ($lines === false) { fwrite(STDERR, "Unable to read config.ini.\n"); exit(1); }
$updates = ["ALLSTAR_VIEW_AUTH_ENABLED" => getenv("ALLSTAR_VIEW_AUTH_ENABLED_VALUE")];
$user = getenv("ALLSTAR_VIEW_ADMIN_USER_VALUE");
$hash = getenv("ALLSTAR_VIEW_ADMIN_HASH_VALUE");
if ($user !== "__KEEP__") $updates["ALLSTAR_VIEW_ADMIN_USER"] = "\"" . addcslashes($user, "\\\"") . "\"";
if ($hash !== "__KEEP__") $updates["ALLSTAR_VIEW_ADMIN_PASSWORD_HASH"] = "\"" . addcslashes($hash, "\\\"") . "\"";
foreach ($updates as $key => $value) {
    $found = false;
    foreach ($lines as &$line) {
        if (preg_match("/^\\s*" . preg_quote($key, "/") . "\\s*=/", $line) === 1) {
            $line = $key . "=" . $value;
            $found = true;
            break;
        }
    }
    unset($line);
    if (!$found) $lines[] = $key . "=" . $value;
}
$tmp = $path . ".tmp." . getmypid();
if (file_put_contents($tmp, implode("\n", $lines) . "\n", LOCK_EX) === false || !rename($tmp, $path)) {
    @unlink($tmp);
    fwrite(STDERR, "Unable to update config.ini.\n");
    exit(1);
}
' "$CONFIG_FILE"

    chown root:"$WEB_GROUP" "$CONFIG_FILE"
    chmod 0640 "$CONFIG_FILE"
}

if [[ "$ACTION" != "normal" ]]; then
    command -v php >/dev/null 2>&1 || fail "php is not installed or not in PATH."
    [[ -f "$CONFIG_FILE" ]] || fail "Missing config.ini. Run normal setup first."
fi

if [[ "$ACTION" == "set-password" ]]; then
    pass1=""
    pass2=""
    hash=""

    [[ -r /dev/tty && -w /dev/tty ]] || fail "An interactive terminal is required. No changes were made."

    IFS= read -r -s -p "New AllStar View admin password: " pass1 < /dev/tty || {
        printf '\n' > /dev/tty
        fail "Unable to read password. No changes were made."
    }
    printf '\n' > /dev/tty
    [[ -n "$pass1" ]] || fail "No password entered. No changes were made."

    IFS= read -r -s -p "Confirm AllStar View admin password: " pass2 < /dev/tty || {
        printf '\n' > /dev/tty
        unset pass1
        fail "Unable to read password confirmation. No changes were made."
    }
    printf '\n' > /dev/tty
    if [[ "$pass1" != "$pass2" ]]; then
        unset pass1 pass2
        fail "Passwords did not match. No changes were made."
    fi

    hash="$(printf '%s' "$pass1" | php -r '$p = stream_get_contents(STDIN); $h = password_hash($p, PASSWORD_DEFAULT); if (!is_string($h)) exit(1); echo $h;')" || {
        unset pass1 pass2 hash
        fail "Password hashing failed. No changes were made."
    }
    unset pass1 pass2
    [[ -n "$hash" ]] || fail "Password hashing failed. No changes were made."

    update_auth_config "1" "admin" "$hash"
    unset hash
    echo "[OK] AllStar View web login enabled and the password hash was saved."
    exit 0
fi

if [[ "$ACTION" == "enable-auth" ]]; then
    saved_hash="$(php -r '$c = parse_ini_file($argv[1], false, INI_SCANNER_RAW); echo trim((string)($c["ALLSTAR_VIEW_ADMIN_PASSWORD_HASH"] ?? ""), "\"");' "$CONFIG_FILE")"
    [[ -n "$saved_hash" ]] || fail "No saved password hash exists. Run --set-admin-password first."
    unset saved_hash
    update_auth_config "1" "__KEEP__" "__KEEP__"
    echo "[OK] AllStar View web login enabled using the saved password hash."
    exit 0
fi

if [[ "$ACTION" == "disable-auth" ]]; then
    update_auth_config "0" "__KEEP__" "__KEEP__"
    echo "[OK] AllStar View web login disabled. The saved password hash was preserved."
    exit 0
fi

missing_packages=()

add_missing_package() {
    local package="$1"
    local existing

    for existing in "${missing_packages[@]}"; do
        [[ "$existing" == "$package" ]] && return 0
    done
    missing_packages+=("$package")
}

command -v apache2ctl >/dev/null 2>&1 || add_missing_package apache2
command -v a2enconf   >/dev/null 2>&1 || add_missing_package apache2
command -v a2disconf  >/dev/null 2>&1 || add_missing_package apache2

if ! command -v php >/dev/null 2>&1; then
    add_missing_package php
    add_missing_package php-cli
    add_missing_package php-curl
elif ! php -r 'exit(extension_loaded("curl") ? 0 : 1);' >/dev/null 2>&1; then
    add_missing_package php-curl
fi

command -v sudo   >/dev/null 2>&1 || add_missing_package sudo
command -v visudo >/dev/null 2>&1 || add_missing_package sudo
[[ -r /etc/ssl/certs/ca-certificates.crt ]] || add_missing_package ca-certificates

if (( ${#missing_packages[@]} > 0 )); then
    [[ "$SKIP_APT" != "1" ]] || fail "Required packages are missing while ALLSTAR_VIEW_SKIP_APT=1 is set: ${missing_packages[*]}"
    command -v apt-get >/dev/null 2>&1 || fail "Required packages are missing, but apt-get is unavailable: ${missing_packages[*]}"

    export DEBIAN_FRONTEND=noninteractive
    run_quiet_command "apt package index update" apt-get update
    run_quiet_command "apt package installation" apt-get install -y "${missing_packages[@]}"
fi

for cmd in php sudo visudo apache2ctl a2enconf a2disconf systemctl; do
    command -v "$cmd" >/dev/null 2>&1 || fail "$cmd is not installed or not in PATH."
done
php -r 'exit(extension_loaded("curl") ? 0 : 1);' >/dev/null 2>&1 || fail "PHP cURL extension is not installed or enabled."
[[ -r /etc/ssl/certs/ca-certificates.crt ]] || fail "CA certificate bundle is missing: /etc/ssl/certs/ca-certificates.crt"
[[ -x /usr/bin/timeout ]] || fail "/usr/bin/timeout is required."
[[ -x /usr/sbin/asterisk ]] || fail "Asterisk was not found at /usr/sbin/asterisk."
id "$WEB_USER" >/dev/null 2>&1 || fail "Web user does not exist: $WEB_USER"

mkdir -p "$APP_DIR/run" "$APP_DIR/logs" "$APP_DIR/cache/stats" "$APP_DIR/cache/echolink"
if [[ ! -f "$CONFIG_FILE" ]]; then
    cp "$CONFIG_EXAMPLE" "$CONFIG_FILE"
    # One-time migration convenience only; runtime never reads AllTune2.
    if [[ -f /var/www/html/alltune2/config.ini ]]; then
        for key in MYNODE DVSWITCH_NODE HIDE_NODES; do
            value="$(awk -F= -v k="$key" '$1 ~ "^[[:space:]]*" k "[[:space:]]*$" {v=$2; sub(/^[[:space:]]+/,"",v); sub(/[[:space:]]+$/,"",v); print v; exit}' /var/www/html/alltune2/config.ini)"
            if [[ -n "$value" ]]; then
                sed -i "s|^[[:space:]]*${key}[[:space:]]*=.*|${key}=${value}|" "$CONFIG_FILE"
            fi
        done
    fi
fi

while IFS= read -r file; do php -l "$file" >/dev/null || fail "PHP syntax failed: $file"; done < <(find "$APP_DIR/app" "$APP_DIR/api" "$APP_DIR/public" "$APP_DIR/src" -type f -name '*.php' -print)
bash -n "$HELPER"; bash -n "$APP_DIR/setup_allstar_view.sh"

find "$APP_DIR" -path "$APP_DIR/run" -prune -o -path "$APP_DIR/logs" -prune -o -path "$APP_DIR/cache" -prune -o -type d -exec chmod 0755 {} +
find "$APP_DIR" -path "$APP_DIR/run" -prune -o -path "$APP_DIR/logs" -prune -o -path "$APP_DIR/cache" -prune -o -type f -exec chmod 0644 {} +
find "$APP_DIR" -path "$APP_DIR/run" -prune -o -path "$APP_DIR/logs" -prune -o -path "$APP_DIR/cache" -prune -o -exec chown root:root {} +
for dir in "$APP_DIR/run" "$APP_DIR/logs" "$APP_DIR/cache"; do
    find "$dir" -type d -exec chmod 0775 {} +
    find "$dir" -type f -exec chmod 0664 {} +
    chown -R "$WEB_USER:$WEB_GROUP" "$dir"
done
chmod 0755 "$APP_DIR/setup_allstar_view.sh" "$HELPER"
chown root:root "$APP_DIR/setup_allstar_view.sh" "$HELPER"
chmod 0640 "$CONFIG_FILE"; chown root:"$WEB_GROUP" "$CONFIG_FILE"

tmp_sudo="$(mktemp)"; trap 'rm -f "$tmp_sudo"' EXIT
printf '%s\n' "$WEB_USER ALL=(root) NOPASSWD: $HELPER *" > "$tmp_sudo"
chmod 0440 "$tmp_sudo"; visudo -cf "$tmp_sudo" >/dev/null || fail "Generated sudoers rule failed validation."
install -o root -g root -m 0440 "$tmp_sudo" "$SUDOERS_FILE"

tmp_conf="$(mktemp)"; old_conf="$(mktemp)"; had_conf=0; was_enabled=0
if [[ -f "$APACHE_CONF" ]]; then cp -a "$APACHE_CONF" "$old_conf"; had_conf=1; fi
if [[ -L "/etc/apache2/conf-enabled/${APACHE_CONF_NAME}.conf" ]]; then was_enabled=1; fi
cat > "$tmp_conf" <<EOF
<Directory "$APP_DIR">
    Options -Indexes
    AllowOverride None
    Require all denied
</Directory>
<Directory "$APP_DIR/public">
    Require all granted
</Directory>
<Directory "$APP_DIR/api">
    Require all granted
</Directory>
EOF
install -o root -g root -m 0644 "$tmp_conf" "$APACHE_CONF"
a2enconf "$APACHE_CONF_NAME" >>"$QUIET_LOG" 2>&1
if ! apache2ctl configtest >>"$QUIET_LOG" 2>&1; then
    if [[ "$had_conf" == "1" ]]; then install -o root -g root -m 0644 "$old_conf" "$APACHE_CONF"; else rm -f "$APACHE_CONF"; fi
    if [[ "$was_enabled" == "1" ]]; then a2enconf "$APACHE_CONF_NAME" >>"$QUIET_LOG" 2>&1 || true; else a2disconf "$APACHE_CONF_NAME" >>"$QUIET_LOG" 2>&1 || true; fi
    apache2ctl configtest >>"$QUIET_LOG" 2>&1 || true
    fail "Apache rejected the AllStar View security configuration; the previous state was restored."
fi
if ! systemctl reload apache2.service >>"$QUIET_LOG" 2>&1; then
    if [[ "$had_conf" == "1" ]]; then install -o root -g root -m 0644 "$old_conf" "$APACHE_CONF"; else rm -f "$APACHE_CONF"; fi
    if [[ "$was_enabled" == "1" ]]; then a2enconf "$APACHE_CONF_NAME" >>"$QUIET_LOG" 2>&1 || true; else a2disconf "$APACHE_CONF_NAME" >>"$QUIET_LOG" 2>&1 || true; fi
    apache2ctl configtest >>"$QUIET_LOG" 2>&1 || true
    systemctl reload apache2.service >>"$QUIET_LOG" 2>&1 || true
    fail "Apache reload failed; the previous AllStar View configuration was restored."
fi
rm -f "$tmp_conf" "$old_conf" "$tmp_sudo"; trap - EXIT

for dir in run logs cache cache/stats cache/echolink; do sudo -u "$WEB_USER" test -w "$APP_DIR/$dir" || fail "$APP_DIR/$dir is not writable by $WEB_USER"; done
sudo -u "$WEB_USER" test ! -w "$APP_DIR/public" || fail "$APP_DIR/public must not be writable by $WEB_USER"

cat <<EOF
[OK] AllStar View setup completed.
URL: /allstar_view/public/
Config: $CONFIG_FILE
Detailed log: $QUIET_LOG
EOF
