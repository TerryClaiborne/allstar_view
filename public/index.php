<?php

declare(strict_types=1);

require_once dirname(__DIR__) . '/app/Support/AppSession.php';
\AllStarView\Support\AppSession::start();

require_once dirname(__DIR__) . '/app/Support/Config.php';
require_once dirname(__DIR__) . '/app/Support/AppAuth.php';

use AllStarView\Support\AppAuth;
use AllStarView\Support\Config;

function e(mixed $value): string
{
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
}

$root = dirname(__DIR__);
$config = new Config($root . '/config.ini');
$auth = new AppAuth($config);
$authEnabled = $auth->isEnabled();
$authLoggedIn = $auth->isLoggedIn();
$authHttpsWarning = $authEnabled && !\AllStarView\Support\AppSession::isHttps();
$repoUrl = 'https://github.com/TerryClaiborne/allstar_view';
$remoteVersionUrl = 'https://raw.githubusercontent.com/TerryClaiborne/allstar_view/main/VERSION';
$localVersion = is_readable($root . '/VERSION') ? trim((string) file_get_contents($root . '/VERSION')) : '0.0.0';
$localVersion = $localVersion !== '' ? $localVersion : '0.0.0';
$myNode = trim($config->getString('MYNODE', ''));
$myNodeIsValid = preg_match('/^[0-9]+$/', $myNode) === 1;
$myNodeStatsUrl = $myNodeIsValid ? 'https://stats.allstarlink.org/stats/' . rawurlencode($myNode) : '';
?>
<!DOCTYPE html>
<html lang="en" data-theme="dark">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AllStar View</title>
    <script>
        (function () {
            try {
                var savedTheme = window.localStorage.getItem('allstar_view_theme');
                document.documentElement.setAttribute('data-theme', savedTheme === 'light' ? 'light' : 'dark');
            } catch (error) {
                document.documentElement.setAttribute('data-theme', 'dark');
            }
        }());
    </script>
    <link rel="stylesheet" href="/allstar_view/public/assets/app-shell.css">
    <link rel="stylesheet" href="/allstar_view/public/assets/allstar-view.css">
</head>
<body>
<div class="page">
    <header class="standalone-header">
        <div class="standalone-theme-zone">
            <div class="standalone-theme-toggle-group" aria-label="Theme selector">
                <span class="standalone-theme-caption">Theme</span>
                <button
                    type="button"
                    class="standalone-theme-toggle"
                    id="theme-toggle"
                    aria-label="Toggle light and dark theme"
                    role="switch"
                    aria-checked="false"
                >
                    <span class="standalone-theme-text standalone-theme-text-light">Light</span>
                    <span class="standalone-theme-text standalone-theme-text-dark">Dark</span>
                    <span class="standalone-theme-thumb" aria-hidden="true"></span>
                </button>
            </div>
        </div>

        <a class="standalone-brand-link" href="<?= e($repoUrl) ?>" target="_blank" rel="noopener noreferrer" aria-label="Open the AllStar View GitHub repository">
            <h1 class="standalone-brand" id="branding-title" data-local-version="<?= e($localVersion) ?>" data-version-url="<?= e($remoteVersionUrl) ?>" title="AllStar View v<?= e($localVersion) ?>">
                <span>AllStar View</span>
                <span class="standalone-brand-bolt" id="update-indicator" aria-hidden="true" title="Installed version: v<?= e($localVersion) ?>">&#9889;</span>
            </h1>
        </a>

        <div class="standalone-auth-status" aria-label="Authentication status">
            <?php if (!$authEnabled): ?>
                <span class="standalone-auth-pill standalone-auth-pill-normal">Normal Mode</span>
            <?php elseif ($authLoggedIn): ?>
                <span class="standalone-auth-pill standalone-auth-pill-signed-in">Signed In</span>
                <a class="standalone-auth-link" href="/allstar_view/public/logout.php">Logout</a>
            <?php else: ?>
                <span class="standalone-auth-pill standalone-auth-pill-view-only">View Only</span>
                <a class="standalone-auth-link" href="/allstar_view/public/login.php">Login</a>
            <?php endif; ?>
        </div>
    </header>

    <?php if ($authHttpsWarning): ?>
        <div class="auth-https-warning">Web login is enabled, but this page is not using HTTPS. Use HTTPS or a VPN before allowing outside access.</div>
    <?php endif; ?>

    <main
        class="allstar-view-page"
        aria-labelledby="allstar-view-title"
        data-status-endpoint="/allstar_view/api/local.php"
        data-downstream-endpoint="/allstar_view/api/downstream.php"
        data-echolink-endpoint="/allstar_view/api/echolink.php"
    >
        <h2 id="allstar-view-title" class="sr-only">AllStar View</h2>

        <section class="allstar-view-summary" aria-label="AllStar View summary">
            <article class="allstar-view-summary-card allstar-view-summary-direct">
                <span class="allstar-view-summary-label">Direct Connections</span>
                <strong id="allstar-view-direct-count">—</strong>
                <span id="allstar-view-direct-note">Loading local Asterisk data</span>
            </article>
            <article class="allstar-view-summary-card allstar-view-summary-downstream">
                <span class="allstar-view-summary-label">Downstream Connections</span>
                <strong id="allstar-view-downstream-count">—</strong>
                <span id="allstar-view-downstream-note">Loading cached tree</span>
            </article>
            <article class="allstar-view-summary-card allstar-view-summary-keyed">
                <span class="allstar-view-summary-label">Keyed Now</span>
                <strong id="allstar-view-keyed-count">—</strong>
                <span id="allstar-view-keyed-note">Waiting for local status</span>
            </article>
            <article class="allstar-view-summary-card allstar-view-summary-refresh">
                <span class="allstar-view-summary-label">Last Refresh</span>
                <strong id="allstar-view-refresh-time">Starting…</strong>
                <span id="allstar-view-refresh-note">Local status snapshot</span>
            </article>
        </section>

        <section class="allstar-view-grid">
            <article class="card allstar-view-card allstar-view-card-connections">
                <div class="card-header">
                    <span>Current Connections</span>
                    <?php if ($myNodeIsValid): ?>
                        <a
                            class="allstar-view-local-node-pill"
                            href="<?= e($myNodeStatsUrl) ?>"
                            target="_blank"
                            rel="noopener noreferrer"
                            title="Open AllStarLink Stats for node <?= e($myNode) ?>"
                            aria-label="Open AllStarLink Stats for node <?= e($myNode) ?>"
                        >Node <?= e($myNode) ?></a>
                    <?php else: ?>
                        <span class="meta-line">Node not set</span>
                    <?php endif; ?>
                </div>
                <div class="card-body">
                    <div class="allstar-view-legend" aria-label="Connection colors">
                        <span class="allstar-view-chip chip-asl">AllStarLink</span>
                        <span class="allstar-view-chip chip-echo">EchoLink</span>
                        <span class="allstar-view-chip chip-iax">True IAX</span>
                        <span class="allstar-view-chip chip-client">Web / Client</span>
                        <span class="allstar-view-chip chip-tx">Transceive</span>
                        <span class="allstar-view-chip chip-monitor">Local Monitor</span>
                        <button
                            type="button"
                            class="allstar-view-audio-toggle"
                            id="allstar-view-audio-toggle"
                            aria-pressed="true"
                            title="Audio Alerts: On — click to turn off"
                        >Audio Alerts</button>
                    </div>
                    <div id="allstar-view-connections" class="allstar-view-connection-list allstar-view-scroll-panel" aria-live="polite" aria-busy="true" tabindex="0">
                        <div class="allstar-view-empty">
                            <span class="allstar-view-empty-icon" aria-hidden="true">&#8644;</span>
                            <strong>Loading local connections…</strong>
                            <p>The page is ready while the local Asterisk snapshot is collected separately.</p>
                        </div>
                    </div>
                    <div id="allstar-view-warning" class="allstar-view-inline-warning" hidden></div>
                </div>
            </article>

            <article class="card allstar-view-card allstar-view-card-downstream">
                <div class="card-header">
                    <span>Downstream Nodes</span>
                    <span class="meta-line">Grouped by direct node</span>
                </div>
                <div class="card-body">
                    <div class="allstar-view-downstream-filters" role="group" aria-label="Filter downstream connections">
                        <button type="button" class="allstar-view-downstream-filter is-active" data-downstream-filter="all" aria-pressed="true">All <strong id="allstar-view-filter-all-count">0</strong></button>
                        <button type="button" class="allstar-view-downstream-filter" data-downstream-filter="nodes" aria-pressed="false">Nodes <strong id="allstar-view-filter-nodes-count">0</strong></button>
                        <button type="button" class="allstar-view-downstream-filter" data-downstream-filter="private" aria-pressed="false">Pvt Nodes <strong id="allstar-view-filter-private-count">0</strong></button>
                        <button type="button" class="allstar-view-downstream-filter" data-downstream-filter="clients" aria-pressed="false">Web/Clients <strong id="allstar-view-filter-clients-count">0</strong></button>
                        <button type="button" class="allstar-view-downstream-filter" data-downstream-filter="echolink" aria-pressed="false">EchoLink <strong id="allstar-view-filter-echolink-count">0</strong></button>
                    </div>
                    <div id="allstar-view-downstream" class="allstar-view-downstream-list allstar-view-scroll-panel" aria-live="polite" aria-busy="true" tabindex="0">
                        <div class="allstar-view-empty allstar-view-empty-compact">
                            <span class="allstar-view-empty-icon" aria-hidden="true">&#9670;</span>
                            <strong>Loading cached downstream tree…</strong>
                            <p>Local status remains fast while the complete downstream tree is scanned separately in cached background steps.</p>
                        </div>
                    </div>
                    <div id="allstar-view-downstream-warning" class="allstar-view-inline-warning" hidden></div>
                </div>
            </article>

            <article class="card allstar-view-card allstar-view-card-activity">
                <div class="card-header">
                    <span>Live Activity</span>
                    <span class="meta-line">Newest first · saved locally</span>
                </div>
                <div class="card-body">
                    <div class="allstar-view-activity-toolbar">
                        <div class="allstar-view-activity-legend" aria-label="Activity colors">
                            <span class="activity-key">Key</span>
                            <span class="activity-unkey">Unkey</span>
                            <span class="activity-connect">Connect</span>
                            <span class="activity-disconnect">Disconnect</span>
                        </div>
                        <div class="allstar-view-activity-actions">
                            <button type="button" class="allstar-view-activity-action allstar-view-activity-toggle" id="allstar-view-activity-toggle" hidden>Show All</button>
                        </div>
                    </div>
                    <div id="allstar-view-activity" class="allstar-view-activity-list allstar-view-scroll-panel" aria-live="polite" tabindex="0">
                        <div class="allstar-view-empty allstar-view-empty-compact">
                            <span class="allstar-view-empty-icon" aria-hidden="true">&#9889;</span>
                            <strong>Watching live changes</strong>
                            <p>Connect, disconnect, key, and unkey events will appear here as they happen.</p>
                        </div>
                    </div>
                </div>
            </article>

            <article class="card allstar-view-card allstar-view-card-details">
                <div class="card-header">
                    <span>Node Details</span>
                    <span class="meta-line">Select a node</span>
                </div>
                <div class="card-body">
                    <div class="allstar-view-detail-preview">
                        <div><span>Node</span><strong id="allstar-view-detail-node">—</strong></div>
                        <div><span>Callsign</span><strong id="allstar-view-detail-call">—</strong></div>
                        <div><span>Connection</span><strong id="allstar-view-detail-path">Select a row</strong></div>
                        <div><span>Location</span><strong id="allstar-view-detail-location">—</strong></div>
                    </div>
                    <div class="allstar-view-detail-description" id="allstar-view-detail-description">
                        —
                    </div>
                    <div class="allstar-view-detail-description allstar-view-detail-helper">
                        Select a connection, downstream node, or activity entry to see its details.
                    </div>
                    <div class="allstar-view-detail-links" id="allstar-view-detail-links" hidden>
                        <a id="allstar-view-detail-qrz" href="#" target="_blank" rel="noopener">QRZ</a>
                    </div>
                </div>
            </article>
        </section>
    </main>
</div>
<script src="/allstar_view/public/assets/header.js"></script>
<script src="/allstar_view/public/assets/audio-alerts.js"></script>
<script src="/allstar_view/public/assets/allstar-view.js"></script>
</body>
</html>
