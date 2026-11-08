<?php
/**
 * Drop-in market route for KushMedia.xyz/dd-evaluator.
 *
 *   GET /api/ddl-market/cards
 *   GET /api/ddl-market/card/V023
 *
 * AGS 10 auction bids in auctions.json are overlaid onto graded prices.
 * While an auction is open, a request older than 10 minutes tries eBay again.
 * The last bid stays on the card after the auction closes.
 */
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-cache');
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
$auctionFile = $dir . '/auctions.json';

if (!is_file($marketFile)) {
  http_response_code(503);
  echo json_encode(['error' => 'market.json missing. Run node build-market.cjs']);
  exit;
}

$market = json_decode((string) file_get_contents($marketFile), true);
$details = is_file($detailFile) ? json_decode((string) file_get_contents($detailFile), true) : [];
if (!is_array($market)) $market = [];
if (!is_array($details)) $details = [];

$auctions = is_file($auctionFile) ? json_decode((string) file_get_contents($auctionFile), true) : null;
if (is_array($auctions)) {
  $auctions = refresh_auctions($auctionFile, $auctions);
  $market = apply_auctions($market, $auctions);
  $details = apply_auction_details($details, $auctions);
}

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

function auction_open(array $auctions, int $now): bool {
  foreach ($auctions['items'] ?? [] as $item) {
    if (!is_array($item)) continue;
    $ends = strtotime((string)($item['endsAt'] ?? ''));
    if ($ends && $ends > $now) return true;
  }
  return false;
}

function ebay_get(string $url): string {
  if ($url === '' || !function_exists('curl_init')) return '';
  $ch = curl_init($url);
  curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 12,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
    CURLOPT_HTTPHEADER => ['Accept: text/html', 'Accept-Language: en-US,en;q=0.9'],
  ]);
  $body = curl_exec($ch);
  curl_close($ch);
  return is_string($body) ? $body : '';
}

function refresh_auctions(string $file, array $auctions): array {
  $now = time();
  if (!auction_open($auctions, $now)) {
    $auctions['live'] = false;
    return $auctions;
  }
  $last = strtotime((string)($auctions['refreshedAt'] ?? ''));
  if ($last && ($now - $last) < 600) return $auctions;

  $html = ebay_get((string)($auctions['searchUrl'] ?? ''));
  $blocked = $html === '' || strlen($html) < 8000 || stripos($html, 'Error Page') !== false;
  $found = 0;
  if (!$blocked) {
    foreach ($auctions['items'] as $i => $item) {
      if (!is_array($item)) continue;
      $id = preg_quote((string)($item['itemId'] ?? ''), '/');
      if ($id === '' || !preg_match('/' . $id . '.{0,2200}/s', $html, $match)) continue;
      $chunk = $match[0];
      $price = null;
      if (preg_match('/\$([0-9][0-9,]*(?:\.\d{2})?).{0,80}?\d+\s*bids?/is', $chunk, $hit)
        || preg_match('/\d+\s*bids?.{0,80}?\$([0-9][0-9,]*(?:\.\d{2})?)/is', $chunk, $hit)
        || preg_match('/"(?:currentBidPrice|bidPrice|convertedCurrentPrice)"\s*:\s*\{[^}]{0,120}"value"\s*:\s*"([0-9.]+)"/i', $chunk, $hit)) {
        $price = $hit;
      }
      if ($price) {
        $bid = (float) str_replace(',', '', $price[1]);
        if ($bid > 0) {
          $auctions['items'][$i]['bidUsd'] = $bid;
          $found++;
        }
      }
      if (preg_match('/(\d+)\s*bids?/i', $chunk, $bids)) {
        $auctions['items'][$i]['bids'] = (int) $bids[1];
      }
    }
  }
  $auctions['live'] = $found > 0;
  $auctions['liveError'] = $found > 0 ? '' : 'eBay did not return bid prices to the server';
  $auctions['refreshedAt'] = gmdate('c');
  @file_put_contents($file, json_encode($auctions, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES) . "\n");
  return $auctions;
}

function apply_auctions(array $market, array $auctions): array {
  $now = time();
  $public = [];
  foreach ($auctions['items'] ?? [] as $item) {
    if (!is_array($item)) continue;
    $usd = (float) ($item['bidUsd'] ?? 0);
    $cardId = (string) ($item['cardId'] ?? '');
    $print = (string) ($item['print'] ?? 'fa');
    $grade = (string) ($item['grade'] ?? 'AGS 10');
    $ends = strtotime((string) ($item['endsAt'] ?? ''));
    $open = $ends && $ends > $now;
    if ($usd <= 0 || $cardId === '' || !isset($market['cards']) || !is_array($market['cards'])) {
      continue;
    }
    foreach ($market['cards'] as $idx => $card) {
      if (!is_array($card) || ($card['id'] ?? '') !== $cardId) continue;
      $graded = $card['graded'] ?? [];
      if (!is_array($graded)) $graded = [];
      if (!isset($graded[$print]) || !is_array($graded[$print])) $graded[$print] = [];
      $graded[$print][$grade] = [
        'usd' => $usd,
        'source' => 'auction',
        'sold' => $open ? 0 : 1,
        'asks' => $open ? 1 : 0,
        'bids' => (int) ($item['bids'] ?? 0),
        'endsAt' => $item['endsAt'] ?? null,
        'url' => $item['url'] ?? null,
        'open' => $open,
      ];
      $market['cards'][$idx]['graded'] = $graded;
    }
    $public[] = [
      'itemId' => $item['itemId'] ?? '',
      'cardId' => $cardId,
      'name' => $item['name'] ?? '',
      'print' => $print,
      'grade' => $grade,
      'title' => $item['title'] ?? '',
      'url' => $item['url'] ?? '',
      'bidUsd' => $usd,
      'bids' => (int) ($item['bids'] ?? 0),
      'endsAt' => $item['endsAt'] ?? null,
      'open' => $open,
    ];
  }
  $market['auctions'] = [
    'searchUrl' => $auctions['searchUrl'] ?? '',
    'refreshedAt' => $auctions['refreshedAt'] ?? null,
    'live' => !empty($auctions['live']),
    'liveError' => $auctions['liveError'] ?? '',
    'endsAt' => $auctions['endsAt'] ?? null,
    'items' => $public,
  ];
  return $market;
}

function apply_auction_details(array $details, array $auctions): array {
  $now = time();
  foreach ($auctions['items'] ?? [] as $item) {
    if (!is_array($item)) continue;
    $cardId = (string) ($item['cardId'] ?? '');
    if ($cardId === '' || !isset($details[$cardId]) || !is_array($details[$cardId])) continue;
    $ends = strtotime((string) ($item['endsAt'] ?? ''));
    $open = $ends && $ends > $now;
    $row = [
      'usd' => (float) ($item['bidUsd'] ?? 0),
      'print' => $item['print'] ?? 'fa',
      'grade' => $item['grade'] ?? 'AGS 10',
      'at' => $auctions['refreshedAt'] ?? null,
      'title' => $item['title'] ?? '',
      'url' => $item['url'] ?? '',
      'source' => 'auction',
      'bids' => (int) ($item['bids'] ?? 0),
      'open' => $open,
    ];
    $key = $open ? 'asks' : 'sold';
    if (!isset($details[$cardId][$key]) || !is_array($details[$cardId][$key])) $details[$cardId][$key] = [];
    array_unshift($details[$cardId][$key], $row);
  }
  return $details;
}
