<?php
declare(strict_types=1);
require_once dirname(__DIR__) . '/app/Support/AppSession.php';
\AllStarView\Support\AppSession::start();
require_once dirname(__DIR__) . '/app/Support/Config.php';
require_once dirname(__DIR__) . '/app/Support/AppAuth.php';
$auth = new \AllStarView\Support\AppAuth(new \AllStarView\Support\Config(dirname(__DIR__) . '/config.ini'));
$auth->logout();
header('Location: /allstar_view/public/');
exit;
