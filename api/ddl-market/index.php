<?php
/**
 * Drop-in market route for KushMedia.xyz/dd-evaluator.
 *
 * The TCG tab already calls:
 *   GET /api/ddl-market/cards
 *   GET /api/ddl-market/card/V023
 * and falls back to /dd-evaluator/ddl-market/...
 *
 * Put this folder at either of those paths. No frontend change required.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: public, max-age=300');
header('X-Robots-Tag: noindex');

$uri = $_SERVER['REQUEST_URI'] ?? '';
$path = $_GET['path'] ?? '';
if ($path === '' && !empty($_SERVER['PATH_INFO'])) $path = $_SERVER['PATH_INFO'];
if ($path === '') $path = $uri;
$path = parse_url($path, PHP_URL_PATH) ?: $path;
$path = preg_replace('#^.*/ddl-market#', '', $path);
$path = '/' . ltrim($path, '/');

$dir = __DIR__;
$marketFile = $dir . '/market.json';
$detailFile = $dir . '/details.json';

if (!is_file($marketFile)) {
  http_response_code(503);
  echo json_encode(['error' => 'market.json missing. Run node build-market.cjs']);
  exit;
}

$market = json_decode((string) file_get_contents($marketFile), true);
$details = is_file($detailFile) ? json_decode((string) file_get_contents($detailFile), true) : [];

if ($path === '/' || $path === '/cards' || $path === '/cards/') {
  echo json_encode($market, JSON_UNESCAPED_SLASHES);
  exit;
}

if (preg_match('#^/card/(V\d{3})/?$#', $path, $m)) {
  $id = $m[1];
  if (!isset($details[$id])) {
    http_response_code(404);
    echo json_encode(['error' => 'unknown card', 'id' => $id]);
    exit;
  }
  echo json_encode($details[$id], JSON_UNESCAPED_SLASHES);
  exit;
}

http_response_code(404);
echo json_encode([
  'error' => 'not found',
  'expect' => ['/cards', '/card/V023'],
  'path' => $path,
]);
