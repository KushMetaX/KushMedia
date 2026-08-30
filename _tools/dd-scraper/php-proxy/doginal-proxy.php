<?php
/**
 * Lightweight proxy for market.doginaldogs.com tRPC calls.
 * Works with cURL or file_get_contents (stream wrapper fallback).
 *
 * Usage:
 *   /api/doginal-proxy.php?action=search&query=7742
 *   /api/doginal-proxy.php?action=traits&dogNumber=7742
 *   /api/doginal-proxy.php?action=image&dogNumber=7742
 *   /api/doginal-proxy.php?action=diag          (debug: shows PHP capabilities)
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$MARKET_BASE = 'https://market.doginaldogs.com';

$action = isset($_GET['action']) ? $_GET['action'] : '';

/* ---- helpers ---- */

function buildTrpcUrl($base, $procedure, $input) {
    $wrapper = new stdClass();
    $wrapper->{'0'} = array('json' => $input);
    $payload = json_encode($wrapper);
    return $base . '/api/trpc/' . $procedure . '?batch=1&input=' . urlencode($payload);
}

function fetchUrl($url, $accept = 'application/json') {
    // Prefer cURL when available
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt_array($ch, array(
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT        => 12,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER     => array(
                'Accept: ' . $accept,
                'trpc-accept: application/json',
                'User-Agent: Mozilla/5.0 (compatible; KushMedia-DogeProxy/1.0)'
            ),
        ));
        $body     = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ct       = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err      = curl_error($ch);
        $errno    = curl_errno($ch);
        curl_close($ch);

        if ($body === false || $errno !== 0) {
            return array('body' => '', 'httpCode' => 0, 'contentType' => '', 'error' => "cURL #{$errno}: {$err}");
        }
        return array('body' => $body, 'httpCode' => $httpCode, 'contentType' => $ct ?: '', 'error' => '');
    }

    // Fallback: file_get_contents (requires allow_url_fopen = On)
    $opts = array('http' => array(
        'method'        => 'GET',
        'header'        => "Accept: {$accept}\r\ntrpc-accept: application/json\r\nUser-Agent: Mozilla/5.0 (compatible; KushMedia-DogeProxy/1.0)\r\n",
        'timeout'       => 12,
        'ignore_errors' => true,
    ), 'ssl' => array(
        'verify_peer' => true,
    ));
    $ctx  = stream_context_create($opts);
    $body = @file_get_contents($url, false, $ctx);

    if ($body === false) {
        return array('body' => '', 'httpCode' => 0, 'contentType' => '', 'error' => 'file_get_contents failed for ' . $url);
    }

    // Parse status from $http_response_header
    $httpCode = 200;
    $ct = '';
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $h) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $h, $m)) {
                $httpCode = intval($m[1]);
            }
            if (stripos($h, 'Content-Type:') === 0) {
                $ct = trim(substr($h, 13));
            }
        }
    }
    return array('body' => $body, 'httpCode' => $httpCode, 'contentType' => $ct, 'error' => '');
}

function sendError($message, $code = 400) {
    http_response_code($code);
    echo json_encode(array('ok' => false, 'message' => $message));
    exit;
}

function sendUpstreamError($label, $result) {
    $detail = $result['error'] ? $result['error'] : "HTTP {$result['httpCode']}";
    sendError("Upstream {$label} failed: {$detail}", 502);
}

function validateDogNumber($raw) {
    if (!isset($raw) || !ctype_digit($raw)) {
        sendError('Invalid inscription number.');
    }
    $num = intval($raw);
    if ($num < 1 || $num > 10000) {
        sendError('Inscription number must be between 1 and 10000.');
    }
    return $num;
}

/* ---- Diagnostic action (remove once working) ---- */

if ($action === 'diag') {
    // Also test a real upstream call
    $testUrl = buildTrpcUrl($MARKET_BASE, 'search.search', array('query' => '7742', 'limit' => 1));
    $testResult = fetchUrl($testUrl);
    echo json_encode(array(
        'ok'               => true,
        'php_version'      => PHP_VERSION,
        'curl_available'   => function_exists('curl_init'),
        'curl_version'     => function_exists('curl_version') ? curl_version()['version'] : null,
        'allow_url_fopen'  => ini_get('allow_url_fopen'),
        'openssl'          => extension_loaded('openssl'),
        'test_url'         => $testUrl,
        'test_httpCode'    => $testResult['httpCode'],
        'test_error'       => $testResult['error'],
        'test_body_len'    => strlen($testResult['body']),
        'test_body_start'  => substr($testResult['body'], 0, 300),
    ));
    exit;
}

/* ---- Actions ---- */

if ($action === 'search') {
    $query = isset($_GET['query']) ? trim($_GET['query']) : '';
    if ($query === '') {
        sendError('Missing query parameter.');
    }
    $url    = buildTrpcUrl($MARKET_BASE, 'search.search', array('query' => $query, 'limit' => 1));
    $result = fetchUrl($url);
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300) {
        sendUpstreamError('search', $result);
    }
    header('Cache-Control: public, max-age=300');
    echo $result['body'];
    exit;
}

if ($action === 'traits') {
    $dogNumber = validateDogNumber(isset($_GET['dogNumber']) ? $_GET['dogNumber'] : null);
    $url    = buildTrpcUrl($MARKET_BASE, 'wallet.getDogTraits', array('dogNumber' => $dogNumber));
    $result = fetchUrl($url);
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300) {
        sendUpstreamError('traits', $result);
    }
    header('Cache-Control: public, max-age=1800');
    echo $result['body'];
    exit;
}

if ($action === 'image') {
    $dogNumber = validateDogNumber(isset($_GET['dogNumber']) ? $_GET['dogNumber'] : null);

    // Find the real image URL via search
    $searchUrl    = buildTrpcUrl($MARKET_BASE, 'search.search', array('query' => strval($dogNumber), 'limit' => 1));
    $searchResult = fetchUrl($searchUrl);
    $imageUrl     = $MARKET_BASE . '/dogs/' . $dogNumber . '.png';

    if ($searchResult['httpCode'] >= 200 && $searchResult['httpCode'] < 300) {
        $decoded = json_decode($searchResult['body'], true);
        if (isset($decoded[0]['result']['data']['json']['results'])) {
            foreach ($decoded[0]['result']['data']['json']['results'] as $item) {
                if (isset($item['dogId']) && intval($item['dogId']) === $dogNumber && !empty($item['imageUrl'])) {
                    $imageUrl = $MARKET_BASE . $item['imageUrl'];
                    break;
                }
            }
        }
    }

    $imgResult = fetchUrl($imageUrl, 'image/*');
    if ($imgResult['httpCode'] < 200 || $imgResult['httpCode'] >= 300 || empty($imgResult['body'])) {
        sendUpstreamError('image', $imgResult);
    }

    $ct = $imgResult['contentType'] ? $imgResult['contentType'] : 'image/png';
    header('Content-Type: ' . $ct);
    header('Cache-Control: public, max-age=86400');
    echo $imgResult['body'];
    exit;
}

sendError('Unknown action. Use search, traits, or image.');
