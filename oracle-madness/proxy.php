<?php
// SPDX-License-Identifier: Apache-2.0
// Oracle Madness · tiny Pyth proxy for cPanel / any PHP 7.4+ host.
//
// Why: since Aug 26 2026 Hermes and Benchmarks need a Pyth API key, and a key
// must never ship in browser JavaScript. This file keeps it server-side.
//
// Routes (GET):
//   proxy.php?route=health                         -> {"ok":true,"keyConfigured":bool}
//   proxy.php?route=latest&ids[]=<hex>&ids[]=...   -> Hermes /v2/updates/price/latest (parsed only)
//   proxy.php?route=history&ts=<unix>&ids[]=<hex>  -> Benchmarks /v1/updates/price/{ts} (signed + parsed)
//
// Key location: a PHP file OUTSIDE public_html (see config.sample.php).
// Default: two levels up from this file, e.g. /home/<you>/oracle-madness-config.php
// when this file lives in /home/<you>/public_html/oracle-madness/proxy.php.
// Override with the OM_CONFIG environment variable.

declare(strict_types=1);

$configPath = getenv('OM_CONFIG') ?: dirname(__DIR__, 2) . '/oracle-madness-config.php';
$config = is_readable($configPath) ? (array) require $configPath : [];
$key        = (string) ($config['pyth_api_key'] ?? '');
$hermes     = rtrim((string) ($config['hermes_base'] ?? 'https://hermes.pyth.network'), '/');
$benchmarks = rtrim((string) ($config['benchmarks_base'] ?? 'https://benchmarks.pyth.network'), '/');
$cacheSec   = max(0, (int) ($config['cache_seconds'] ?? 1));
$origins    = (array) ($config['allowed_origins'] ?? []);

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');
header('Cache-Control: no-store');
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && in_array($origin, $origins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Vary: Origin');
}

function out(int $code, array $body): void {
    http_response_code($code);
    echo json_encode($body, JSON_UNESCAPED_SLASHES);
    exit;
}

function feed_ids(): array {
    $raw = $_GET['ids'] ?? [];
    if (!is_array($raw)) $raw = [$raw];
    $ids = [];
    foreach ($raw as $id) {
        $id = strtolower(preg_replace('/^0x/i', '', (string) $id));
        if (!preg_match('/^[0-9a-f]{64}$/', $id)) out(400, ['error' => 'bad feed id']);
        $ids[$id] = true;
    }
    $ids = array_keys($ids);
    if (!$ids || count($ids) > 32) out(400, ['error' => 'need 1-32 feed ids']);
    sort($ids);
    return $ids;
}

function upstream(string $url, string $key, int $ttl): array {
    $cacheFile = sys_get_temp_dir() . '/om_' . sha1($url) . '.json';
    if ($ttl > 0 && is_file($cacheFile) && (time() - filemtime($cacheFile)) < $ttl) {
        return [200, (string) file_get_contents($cacheFile)];
    }
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 8,
        CURLOPT_CONNECTTIMEOUT => 4,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $key, 'Accept: application/json'],
        CURLOPT_USERAGENT      => 'oracle-madness-proxy/0.1',
    ]);
    $body = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    if ($body === false) return [502, json_encode(['error' => 'upstream unreachable'])];
    if ($code === 200 && $ttl > 0) @file_put_contents($cacheFile, $body, LOCK_EX);
    return [$code, (string) $body];
}

$route = $_GET['route'] ?? 'health';

if ($route === 'health') {
    out(200, ['ok' => true, 'keyConfigured' => $key !== '']);
}
if ($key === '') out(503, ['error' => 'Pyth API key not configured on the server']);

if ($route === 'latest') {
    $ids = feed_ids();
    // Hermes fails the whole batch if the key isn't entitled to one feed, so
    // remember denied feeds for a while and leave them out of later batches.
    $deniedFile = sys_get_temp_dir() . '/om_denied_' . sha1($key) . '.json';
    $denied = [];
    if (is_file($deniedFile) && (time() - filemtime($deniedFile)) < 600) {
        $denied = (array) json_decode((string) file_get_contents($deniedFile), true);
    }
    $want = array_values(array_diff($ids, $denied));
    $latest = function (array $set) use ($hermes, $key, $cacheSec) {
        $q = implode('&', array_map(fn($id) => 'ids[]=' . $id, $set));
        return upstream("$hermes/v2/updates/price/latest?$q&parsed=true", $key, $cacheSec);
    };
    $parsed = [];
    if ($want) {
        [$code, $body] = $latest($want);
        if ($code === 200) {
            $parsed = (array) (json_decode($body, true)['parsed'] ?? []);
        } elseif (in_array($code, [400, 403, 404], true)) {
            $newlyDenied = [];
            foreach ($want as $id) {
                [$c1, $b1] = $latest([$id]);
                if ($c1 === 200) {
                    $parsed = array_merge($parsed, (array) (json_decode($b1, true)['parsed'] ?? []));
                } elseif (in_array($c1, [400, 403, 404], true)) {
                    $newlyDenied[] = $id;
                    $detail = substr(trim($b1), 0, 200);
                } else {
                    out($c1 >= 400 ? $c1 : 502, ['error' => 'hermes error', 'status' => $c1, 'detail' => substr(trim($b1), 0, 200)]);
                }
            }
            if ($newlyDenied) {
                $all = array_values(array_unique(array_merge($denied, $newlyDenied)));
                @file_put_contents($deniedFile, json_encode($all), LOCK_EX);
            }
        } else {
            out($code >= 400 ? $code : 502, ['error' => 'hermes error', 'status' => $code, 'detail' => substr(trim($body), 0, 200)]);
        }
    }
    $deniedHere = array_values(array_diff($ids, array_map(fn($p) => strtolower((string) ($p['id'] ?? '')), $parsed)));
    $res = ['parsed' => $parsed, 'denied' => $deniedHere];
    if (isset($detail)) $res['denied_detail'] = $detail;
    out(200, $res);
}

if ($route === 'history') {
    $ids = feed_ids();
    $ts = (int) ($_GET['ts'] ?? 0);
    if ($ts < 1600000000 || $ts > time() + 5) out(400, ['error' => 'bad timestamp']);
    $q = implode('&', array_map(fn($id) => 'ids=' . $id, $ids));
    // Historical updates never change, so cache them for a day.
    [$code, $body] = upstream("$benchmarks/v1/updates/price/$ts?$q&encoding=hex&parsed=true", $key, 86400);
    $src = 'benchmarks.pyth.network';
    if ($code !== 200) {
        // Fallback: Hermes serves the same signed updates by publish time.
        $q2 = implode('&', array_map(fn($id) => 'ids[]=' . $id, $ids));
        [$code, $body] = upstream("$hermes/v2/updates/price/$ts?$q2&encoding=hex&parsed=true", $key, 86400);
        $src = 'hermes.pyth.network (historical)';
    }
    if ($code !== 200) out($code >= 400 ? $code : 502, ['error' => 'history error', 'status' => $code]);
    $j = json_decode($body, true) ?: [];
    // Benchmarks may return a list of updates; normalise to Hermes shape.
    if (isset($j[0]) && is_array($j[0])) $j = $j[0];
    $j['_source'] = $src;
    out(200, $j);
}

out(404, ['error' => 'unknown route']);
