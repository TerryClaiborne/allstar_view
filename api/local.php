<?php
declare(strict_types=1);

require_once dirname(__DIR__) . '/app/Support/AppSession.php';
\AllStarView\Support\AppSession::start();
session_write_close();

require_once dirname(__DIR__) . '/app/Support/Config.php';
require_once dirname(__DIR__) . '/src/Monitor.php';

use AllStarView\Monitor;
use AllStarView\Support\Config;

header('Content-Type: application/json; charset=UTF-8');
header('Cache-Control: no-store, max-age=0');

try {
    $monitor = new Monitor(new Config(dirname(__DIR__) . '/config.ini'));
    echo json_encode([
        'ok' => true,
        'data' => $monitor->snapshot(),
    ], JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
} catch (Throwable $error) {
    http_response_code(500);
    echo json_encode([
        'ok' => false,
        'message' => 'AllStar View local status is unavailable.',
    ], JSON_UNESCAPED_SLASHES);
}
