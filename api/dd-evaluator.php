<?php
/**
 * Doginal Dogs evaluator for shared hosting / PHP environments.
 *
 * This mirrors the browser contract used by dd-evaluator/index.html so the
 * live site can work without the Node.js /api/dd-evaluator backend.
 *
 * Usage:
 *   /api/dd-evaluator.php?action=evaluate&dogNumber=7742
 *   /api/dd-evaluator.php?action=community-lore&dogNumber=7742
 *   /api/dd-evaluator.php?action=snapshot_status
 */

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, x-dd-admin-password, x-dd-community-password');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json; charset=utf-8');

$MARKET_BASE = 'https://market.doginaldogs.com';
$TRAIT_KEYS = array('background', 'furColor', 'furPattern', 'head', 'clothes', 'mouth', 'eyes', 'accessory');
$action = isset($_GET['action']) ? trim(strtolower(strval($_GET['action']))) : '';
$CATALOG_CANDIDATE_PATHS = array();
$catalogEnvPath = getenv('DD_CATALOG_PATH');
$catalogDisabled = getenv('DD_DISABLE_CATALOG');
if ($catalogEnvPath) {
    $CATALOG_CANDIDATE_PATHS[] = $catalogEnvPath;
}
$CATALOG_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'DoginalDogsCatalog.json';
$CATALOG_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'assets' . DIRECTORY_SEPARATOR . 'DoginalDogsCatalog.json';
$TRENDING_CONFIG_CANDIDATE_PATHS = array();
$trendingConfigEnvPath = getenv('DD_TRENDING_CONFIG_PATH');
if ($trendingConfigEnvPath) {
    $TRENDING_CONFIG_CANDIDATE_PATHS[] = $trendingConfigEnvPath;
}
$TRENDING_CONFIG_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'dd-trending-config.json';
$EVALUATION_LOG_CANDIDATE_PATHS = array();
$evaluationLogEnvPath = getenv('DD_EVALUATION_LOG_PATH');
if ($evaluationLogEnvPath) {
    $EVALUATION_LOG_CANDIDATE_PATHS[] = $evaluationLogEnvPath;
}
$EVALUATION_LOG_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'dd-evaluation-log.ndjson';
$MARKET_PULSE_CACHE_CANDIDATE_PATHS = array(
    dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'dd-market-pulse-cache.json',
    sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'dd-market-pulse-cache.json',
);
$DD_ADMIN_PASSWORD_FILE_CANDIDATE_PATHS = array();
$ddAdminPasswordFileEnvPath = getenv('DD_ADMIN_PASSWORD_FILE');
if ($ddAdminPasswordFileEnvPath) {
    $DD_ADMIN_PASSWORD_FILE_CANDIDATE_PATHS[] = $ddAdminPasswordFileEnvPath;
}
$DD_ADMIN_PASSWORD_FILE_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . '.dd-admin-password';
$DD_COMMUNITY_PASSWORD_FILE_CANDIDATE_PATHS = array();
$ddCommunityPasswordFileEnvPath = getenv('DD_COMMUNITY_PASSWORD_FILE');
if ($ddCommunityPasswordFileEnvPath) {
    $DD_COMMUNITY_PASSWORD_FILE_CANDIDATE_PATHS[] = $ddCommunityPasswordFileEnvPath;
}
$DD_COMMUNITY_PASSWORD_FILE_CANDIDATE_PATHS[] = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . '.dd-community-password';
$DD_IMPORT_LOOKBACK_HOURS = 48;
$DD_IMPORT_MAX_EVENTS = 2000;

function buildTrpcUrl($base, $procedure, $input) {
    $wrapper = new stdClass();
    $wrapper->{'0'} = array('json' => $input);
    $payload = json_encode($wrapper);
    return $base . '/api/trpc/' . $procedure . '?batch=1&input=' . urlencode($payload);
}

function fetchUrl($url, $accept = 'application/json') {
    if (function_exists('curl_init')) {
        $ch = curl_init();
        curl_setopt_array($ch, array(
            CURLOPT_URL => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_HTTPHEADER => array(
                'Accept: ' . $accept,
                'trpc-accept: application/json',
                'User-Agent: Mozilla/5.0 (compatible; KushMedia-DDEvaluator/1.0)'
            ),
        ));
        $body = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $ct = curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        $err = curl_error($ch);
        $errno = curl_errno($ch);
        curl_close($ch);

        if ($body === false || $errno !== 0) {
            return array('body' => '', 'httpCode' => 0, 'contentType' => '', 'error' => "cURL #{$errno}: {$err}");
        }

        return array('body' => $body, 'httpCode' => $httpCode, 'contentType' => $ct ?: '', 'error' => '');
    }

    $opts = array(
        'http' => array(
            'method' => 'GET',
            'header' => "Accept: {$accept}\r\ntrpc-accept: application/json\r\nUser-Agent: Mozilla/5.0 (compatible; KushMedia-DDEvaluator/1.0)\r\n",
            'timeout' => 20,
            'ignore_errors' => true,
        ),
        'ssl' => array(
            'verify_peer' => true,
        )
    );

    $ctx = stream_context_create($opts);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) {
        return array('body' => '', 'httpCode' => 0, 'contentType' => '', 'error' => 'file_get_contents failed for ' . $url);
    }

    $httpCode = 200;
    $ct = '';
    if (isset($http_response_header) && is_array($http_response_header)) {
        foreach ($http_response_header as $headerLine) {
            if (preg_match('/^HTTP\/\S+\s+(\d{3})/', $headerLine, $matches)) {
                $httpCode = intval($matches[1]);
            }
            if (stripos($headerLine, 'Content-Type:') === 0) {
                $ct = trim(substr($headerLine, 13));
            }
        }
    }

    return array('body' => $body, 'httpCode' => $httpCode, 'contentType' => $ct, 'error' => '');
}

function sendJson($payload, $status = 200, $cacheSeconds = null) {
    http_response_code($status);
    if ($cacheSeconds !== null) {
        if ($cacheSeconds <= 0) {
            header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
        } else {
            header('Cache-Control: public, max-age=' . intval($cacheSeconds));
        }
    }
    echo json_encode($payload);
    exit;
}

function sendError($message, $status = 400, $extra = array()) {
    $payload = array('error' => $message);
    foreach ($extra as $key => $value) {
        $payload[$key] = $value;
    }
    sendJson($payload, $status, 30);
}

/**
 * Guest quotas on the PHP evaluate path (mirrors Node public/server/routes/dd-paywall.js).
 * Does not grant Plus bypass — authenticated Plus users should use the Node API only.
 */
function dd_paywall_env_int($key, $default) {
    $v = getenv($key);
    if ($v === false || trim(strval($v)) === '') {
        return $default;
    }
    return intval($v);
}

function dd_paywall_client_ip_php() {
    $xff = isset($_SERVER['HTTP_X_FORWARDED_FOR']) ? trim(strval($_SERVER['HTTP_X_FORWARDED_FOR'])) : '';
    if ($xff !== '') {
        $parts = explode(',', $xff);
        $first = trim(strval($parts[0]));
        if ($first !== '') {
            return $first;
        }
    }
    return isset($_SERVER['REMOTE_ADDR']) ? strval($_SERVER['REMOTE_ADDR']) : 'unknown';
}

function dd_paywall_free_inscriptions_cap() {
    $n = dd_paywall_env_int('DD_FREE_INSCRIPTION_PER_DAY', 2);
    return max(0, min(10000, $n));
}

function dd_paywall_free_rarity_cap() {
    $n = dd_paywall_env_int('DD_FREE_RARITY_LOOKUPS_PER_DAY', 1);
    return max(0, min(10000, $n));
}

function dd_paywall_quota_storage_path($day) {
    $cleanDay = preg_replace('/[^0-9\\-]/', '', strval($day));
    return sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'dd-php-quota-' . $cleanDay . '.json';
}

function dd_paywall_quota_try_consume($bucketKey, $cap) {
    $day = gmdate('Y-m-d');
    $ip = dd_paywall_client_ip_php();

    header('DD-Quota-Free-Limit-Inscribe: ' . strval(dd_paywall_free_inscriptions_cap()));
    header('DD-Quota-Free-Limit-Rarity: ' . strval(dd_paywall_free_rarity_cap()));
    header('DD-Quota-Free-Ip: ' . $ip);

    if ($cap === 0) {
        $msg = ($bucketKey === 'rarity')
            ? 'Rarity valuations are gated for guests. KushMetaX Doginal Dogs Plus unlocks unlimited access.'
            : 'Inscription valuations are gated for guests. KushMetaX Doginal Dogs Plus unlocks unlimited access.';
        sendJson(array('code' => 'dd_guest_quota_exceeded', 'error' => $msg), 429, 0);
    }

    $path = dd_paywall_quota_storage_path($day);
    $fp = @fopen($path, 'c+');
    if (!$fp) {
        sendError('Guest quota storage unavailable.', 503);
    }

    if (!flock($fp, LOCK_EX)) {
        fclose($fp);
        sendError('Quota service busy.', 503);
    }

    $raw = stream_get_contents($fp);
    $data = array('day' => $day, 'buckets' => array());
    if ($raw !== false && trim(strval($raw)) !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded) && isset($decoded['day']) && strval($decoded['day']) === $day && isset($decoded['buckets']) && is_array($decoded['buckets'])) {
            $data = $decoded;
        }
    }

    if (!isset($data['buckets'][$ip]) || !is_array($data['buckets'][$ip])) {
        $data['buckets'][$ip] = array('inscribe' => 0, 'rarity' => 0);
    }

    $usedIns = intval(isset($data['buckets'][$ip]['inscribe']) ? $data['buckets'][$ip]['inscribe'] : 0);
    $usedRar = intval(isset($data['buckets'][$ip]['rarity']) ? $data['buckets'][$ip]['rarity'] : 0);
    $used = ($bucketKey === 'rarity') ? $usedRar : $usedIns;

    if ($used >= $cap) {
        flock($fp, LOCK_UN);
        fclose($fp);
        $msg = ($bucketKey === 'rarity')
            ? ('Free tier allows ' . $cap . ' rarity-rank valuations per UTC day at this IP (' . $ip . '). Subscribe for unlimited valuations and wallet estimates.')
            : ('Free tier allows ' . $cap . ' inscription valuations per UTC day at this IP (' . $ip . '). Subscribe for unlimited valuations and wallet estimates.');
        sendJson(array('code' => 'dd_guest_quota_exceeded', 'error' => $msg), 429, 0);
    }

    if ($bucketKey === 'rarity') {
        $data['buckets'][$ip]['rarity'] = $usedRar + 1;
    } else {
        $data['buckets'][$ip]['inscribe'] = $usedIns + 1;
    }
    $data['day'] = $day;

    if (!ftruncate($fp, 0)) {
        flock($fp, LOCK_UN);
        fclose($fp);
        sendError('Quota service busy.', 503);
    }

    rewind($fp);
    fwrite($fp, json_encode($data));
    fflush($fp);
    flock($fp, LOCK_UN);
    fclose($fp);
}

function getWritableCachePath($candidates) {
    foreach ($candidates as $path) {
        if (!$path) {
            continue;
        }

        $dir = dirname($path);
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        if (is_dir($dir) && (!file_exists($path) || is_writable($path) || is_writable($dir))) {
            return $path;
        }
    }

    return null;
}

function readJsonCacheFile($path) {
    if (!$path || !is_file($path) || !is_readable($path)) {
        return null;
    }

    $raw = @file_get_contents($path);
    if ($raw === false || trim($raw) === '') {
        return null;
    }

    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : null;
}

function writeJsonCacheFile($path, $payload) {
    if (!$path) {
        return;
    }
    @file_put_contents($path, json_encode($payload), LOCK_EX);
}

function getRequestHeader($name) {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    return isset($_SERVER[$key]) ? $_SERVER[$key] : null;
}

function getJsonRequestBody() {
    static $loaded = false;
    static $body = array();

    if ($loaded) {
        return $body;
    }

    $loaded = true;
    $raw = @file_get_contents('php://input');
    if ($raw === false || trim($raw) === '') {
        $body = array();
        return $body;
    }

    $decoded = json_decode($raw, true);
    $body = is_array($decoded) ? $decoded : array();
    return $body;
}

function getExpectedDdAdminPassword() {
    global $DD_ADMIN_PASSWORD_FILE_CANDIDATE_PATHS;

    $primary = getenv('DD_ADMIN_PASSWORD');
    $fallback = getenv('KUSH_ADMIN_PASSWORD');
    $password = trim(strval($primary ? $primary : ($fallback ? $fallback : '')));
    if ($password !== '') {
        return $password;
    }

    foreach ($DD_ADMIN_PASSWORD_FILE_CANDIDATE_PATHS as $path) {
        if (!$path || !is_file($path) || !is_readable($path)) {
            continue;
        }

        $filePassword = trim(strval(@file_get_contents($path)));
        if ($filePassword !== '') {
            return $filePassword;
        }
    }

    return '';
}

function getExpectedCommunityPassword() {
    global $DD_COMMUNITY_PASSWORD_FILE_CANDIDATE_PATHS;

    $primary = getenv('DD_COMMUNITY_PASSWORD');
    $password = trim(strval($primary ? $primary : ''));
    if ($password !== '') {
        return $password;
    }

    foreach ($DD_COMMUNITY_PASSWORD_FILE_CANDIDATE_PATHS as $path) {
        if (!$path || !is_file($path) || !is_readable($path)) {
            continue;
        }

        $filePassword = trim(strval(@file_get_contents($path)));
        if ($filePassword !== '') {
            return $filePassword;
        }
    }

    return '';
}

function getCommunitySuggestionsStorePath() {
    $env = getenv('DD_COMMUNITY_SUGGESTIONS_PATH');
    if ($env && trim(strval($env)) !== '') {
        return trim(strval($env));
    }

    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'dd-community-suggestions.json';
}

function readSuggestionsStorePhp() {
    $path = getCommunitySuggestionsStorePath();
    if (!is_file($path)) {
        return array('version' => 1, 'items' => array());
    }

    $raw = @file_get_contents($path);
    $parsed = json_decode($raw, true);
    if (!is_array($parsed) || !isset($parsed['items']) || !is_array($parsed['items'])) {
        return array('version' => 1, 'items' => array());
    }

    return array('version' => 1, 'items' => $parsed['items']);
}

function writeSuggestionsStorePhp($store) {
    $path = getCommunitySuggestionsStorePath();
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }

    $json = json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    if (@file_put_contents($path, $json, LOCK_EX) === false) {
        throw new Exception('Unable to write suggestions store.');
    }
}

function getCommunityNotesStorePath() {
    $env = getenv('DD_COMMUNITY_NOTES_PATH');
    if ($env && trim(strval($env)) !== '') {
        return trim(strval($env));
    }

    return dirname(__DIR__) . DIRECTORY_SEPARATOR . 'server' . DIRECTORY_SEPARATOR . 'data' . DIRECTORY_SEPARATOR . 'dd-community-notes.json';
}

/** Coerce note payloads to plain strings for evaluator + admin list. */
function normalizeCommunityLoreNoteValuePhp($v) {
    if (is_string($v)) {
        return trim($v);
    }
    if (!is_array($v)) {
        return '';
    }
    if (isset($v['lore']) && is_string($v['lore'])) {
        return trim($v['lore']);
    }
    if (isset($v['text']) && is_string($v['text'])) {
        return trim($v['text']);
    }
    if (isset($v['body']) && is_string($v['body'])) {
        return trim($v['body']);
    }

    return '';
}

function readCommunityNotesStorePhp() {
    $path = getCommunityNotesStorePath();
    if (!is_file($path)) {
        return array('version' => 1, 'notes' => array());
    }

    $raw = @file_get_contents($path);
    if (!is_string($raw) || $raw === '') {
        return array('version' => 1, 'notes' => array());
    }
    $raw = preg_replace('/^\xEF\xBB\xBF/', '', $raw);
    $parsed = json_decode($raw, true);
    if (!is_array($parsed)) {
        return array('version' => 1, 'notes' => array());
    }

    $notes = array();
    if (isset($parsed['notes']) && is_array($parsed['notes'])) {
        foreach ($parsed['notes'] as $k => $v) {
            $norm = normalizeCommunityLoreNoteValuePhp($v);
            if ($norm !== '') {
                $notes[strval($k)] = $norm;
            }
        }
    }
    foreach ($parsed as $k => $v) {
        if ($k === 'version' || $k === 'notes') {
            continue;
        }
        $norm = normalizeCommunityLoreNoteValuePhp($v);
        if ($norm !== '') {
            $notes[strval($k)] = $norm;
        }
    }

    return array('version' => 1, 'notes' => $notes);
}

function writeCommunityNotesStorePhp($store) {
    $path = getCommunityNotesStorePath();
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }

    $json = json_encode($store, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
    if (@file_put_contents($path, $json, LOCK_EX) === false) {
        throw new Exception('Unable to write community notes store.');
    }
}

function communityNotesDogCountPhp() {
    $ns = readCommunityNotesStorePhp();
    return count(isset($ns['notes']) && is_array($ns['notes']) ? $ns['notes'] : array());
}

function lookupCommunityLoreInNotesMapPhp($nmap, $dogNumber) {
    if (!is_array($nmap)) {
        return null;
    }
    $n = intval($dogNumber);
    if ($n < 1 || $n > 10000) {
        return null;
    }
    $preferred = array(strval($n), strval(intval($dogNumber)));
    foreach ($preferred as $k) {
        if (isset($nmap[$k])) {
            $t = normalizeCommunityLoreNoteValuePhp($nmap[$k]);
            if ($t !== '') {
                return $t;
            }
        }
    }
    foreach ($nmap as $k => $v) {
        $t = normalizeCommunityLoreNoteValuePhp($v);
        if ($t === '') {
            continue;
        }
        $ks = trim(strval($k));
        if ($ks !== '' && ctype_digit($ks) && intval($ks) === $n) {
            return $t;
        }
    }
    return null;
}

function ddAdminSlugComboId($label, $suggestionId) {
    $base = strtolower(preg_replace('/[^a-z0-9]+/i', '-', strval($label ? $label : 'combo')));
    $base = trim($base, '-');
    if (strlen($base) > 48) {
        $base = substr($base, 0, 48);
    }
    if ($base === '') {
        $base = 'combo';
    }
    $idFrag = substr(str_replace('-', '', strval($suggestionId)), 0, 12);

    return $base . '-' . $idFrag;
}

function mergeApprovedSuggestionPhp($item) {
    $kind = isset($item['kind']) ? strval($item['kind']) : '';
    $payload = isset($item['payload']) && is_array($item['payload']) ? $item['payload'] : array();
    $mergeResult = array();

    $cfg = getTrendingConfigData(true);

    if ($kind === 'trait_multiplier') {
        $traitKey = isset($payload['traitKey']) ? strval($payload['traitKey']) : '';
        $traitValue = isset($payload['traitValue']) ? strval($payload['traitValue']) : '';
        $multKey = $traitKey . ':' . $traitValue;
        $mm = isset($cfg['manualMultipliers']) && is_array($cfg['manualMultipliers']) ? $cfg['manualMultipliers'] : array();
        $mm[$multKey] = isset($payload['multiplier']) ? floatval($payload['multiplier']) : 1.0;
        updateTrendingConfigData(array(
            'manualMultipliers' => $mm,
            'updatedBy' => 'community-approve',
        ));
        $mergeResult['manualMultiplierKey'] = $multKey;
    } elseif ($kind === 'combo') {
        $sm = isset($cfg['specialMultipliers']) && is_array($cfg['specialMultipliers']) ? $cfg['specialMultipliers'] : array();
        $combos = isset($sm['combos']) && is_array($sm['combos']) ? $sm['combos'] : array();
        $comboId = ddAdminSlugComboId(isset($payload['label']) ? $payload['label'] : 'combo', isset($item['id']) ? $item['id'] : '');
        $entry = array(
            'id' => $comboId,
            'label' => isset($payload['label']) ? strval($payload['label']) : '',
            'conditions' => isset($payload['conditions']) && is_array($payload['conditions']) ? $payload['conditions'] : array(),
            'multiplier' => max(1.01, floatval(isset($payload['multiplier']) ? $payload['multiplier'] : 1.01)),
            'enabled' => true,
        );
        $idx = -1;
        foreach ($combos as $i => $c) {
            if (is_array($c) && isset($c['id']) && strval($c['id']) === $comboId) {
                $idx = intval($i);
                break;
            }
        }
        if ($idx >= 0) {
            $combos[$idx] = $entry;
        } else {
            $combos[] = $entry;
        }
        $sm['combos'] = $combos;
        updateTrendingConfigData(array(
            'specialMultipliers' => $sm,
            'updatedBy' => 'community-approve',
        ));
        $mergeResult['comboId'] = $comboId;
    } elseif ($kind === 'suppress_trend') {
        $trendKey = isset($payload['trendKey']) ? strval($payload['trendKey']) : '';
        $auto = isset($cfg['autoTrend']) && is_array($cfg['autoTrend']) ? $cfg['autoTrend'] : array();
        $keys = isset($auto['disabledTrendKeys']) && is_array($auto['disabledTrendKeys']) ? $auto['disabledTrendKeys'] : array();
        if ($trendKey !== '' && !in_array($trendKey, $keys, true)) {
            $keys[] = $trendKey;
        }
        $auto['disabledTrendKeys'] = $keys;
        updateTrendingConfigData(array(
            'autoTrend' => $auto,
            'updatedBy' => 'community-approve',
        ));
        $mergeResult['suppressedTrendKey'] = $trendKey;
    } elseif ($kind === 'lore_only') {
        $dogNumber = strval(isset($payload['dogNumber']) ? $payload['dogNumber'] : '');
        $lore = isset($payload['lore']) ? strval($payload['lore']) : '';
        $ns = readCommunityNotesStorePhp();
        $notes = isset($ns['notes']) && is_array($ns['notes']) ? $ns['notes'] : array();
        $notes[$dogNumber] = $lore;
        $ns['notes'] = $notes;
        writeCommunityNotesStorePhp($ns);
        $mergeResult['dogNumber'] = $payload['dogNumber'];
    } else {
        throw new Exception('Unknown suggestion kind.');
    }

    return $mergeResult;
}

function assertDdAdminApiPasswordOr401() {
    $expected = getExpectedDdAdminPassword();
    $provided = trim(strval(getRequestHeader('x-dd-admin-password')));
    if ($expected === '' || $provided === '' || !hash_equals($expected, $provided)) {
        sendError('Invalid DD admin password.', 401);
    }
}

function ddCommunitySuggestionsRateLimited($ip) {
    $max = 60;
    $window = 15 * 60;
    $path = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'dd-cs-rl-' . md5(strval($ip)) . '.json';
    $now = time();

    $resetAt = $now + $window;
    $count = 1;

    if (is_file($path)) {
        $prev = json_decode(@file_get_contents($path), true);
        if (is_array($prev) && isset($prev['resetAt']) && isset($prev['count'])) {
            $prevReset = intval($prev['resetAt']);
            $prevCount = intval($prev['count']);
            if ($now <= $prevReset) {
                if ($prevCount >= $max) {
                    return true;
                }
                $resetAt = $prevReset;
                $count = $prevCount + 1;
            }
        }
    }

    @file_put_contents($path, json_encode(array('resetAt' => $resetAt, 'count' => $count)), LOCK_EX);
    return false;
}

function ddSuggestionUuid() {
    $bytes = random_bytes(16);
    $bytes[6] = chr(ord($bytes[6]) & 0x0f | 0x40);
    $bytes[8] = chr(ord($bytes[8]) & 0x3f | 0x80);
    $hex = bin2hex($bytes);

    return substr($hex, 0, 8) . '-' . substr($hex, 8, 4) . '-' . substr($hex, 12, 4) . '-' . substr($hex, 16, 4) . '-' . substr($hex, 20, 12);
}

function validateSuggestionPayloadPhp($kind, $raw) {
    global $TRAIT_KEYS;

    if (!$kind || !is_string($kind)) {
        throw new Exception('Missing suggestion kind.');
    }

    $k = trim($kind);

    if ($k === 'trait_multiplier') {
        $traitKey = trim(strval(isset($raw['traitKey']) ? $raw['traitKey'] : ''));
        $traitValue = trim(strval(isset($raw['traitValue']) ? $raw['traitValue'] : ''));
        $multiplier = floatval(isset($raw['multiplier']) ? $raw['multiplier'] : 0);

        if (!in_array($traitKey, $TRAIT_KEYS, true)) {
            throw new Exception('Invalid traitKey.');
        }
        if ($traitValue === '') {
            throw new Exception('traitValue is required.');
        }
        if (!is_finite($multiplier) || $multiplier < 1) {
            throw new Exception('multiplier must be >= 1.');
        }

        return array(
            'traitKey' => $traitKey,
            'traitValue' => $traitValue,
            'multiplier' => round($multiplier, 4),
        );
    }

    if ($k === 'combo') {
        $label = trim(strval(isset($raw['label']) ? $raw['label'] : ''));
        $multiplier = floatval(isset($raw['multiplier']) ? $raw['multiplier'] : 0);
        $conditions = isset($raw['conditions']) && is_array($raw['conditions']) ? $raw['conditions'] : array();

        if ($label === '') {
            throw new Exception('label is required.');
        }
        if (!is_finite($multiplier) || $multiplier == 0.0) {
            throw new Exception('combo multiplier must be non-zero.');
        }

        $normalizedCond = array();
        foreach ($conditions as $c) {
            if (!is_array($c)) {
                continue;
            }

            $trait = trim(strval(isset($c['trait']) ? $c['trait'] : ''));
            $value = trim(strval(isset($c['value']) ? $c['value'] : ''));
            if (!in_array($trait, $TRAIT_KEYS, true) || $value === '') {
                continue;
            }

            $vl = strtolower($value);
            if ($vl === 'any') {
                $value = 'Any';
            } elseif ($vl === 'none') {
                $value = 'None';
            }

            $op = (isset($c['op']) && strval($c['op']) === 'contains') ? 'contains' : 'eq';
            $normalizedCond[] = array(
                'trait' => $trait,
                'op' => $op,
                'value' => $value,
            );
        }

        if (count($normalizedCond) === 0) {
            throw new Exception('combo requires at least one valid condition.');
        }

        return array(
            'label' => $label,
            'multiplier' => round($multiplier, 4),
            'conditions' => $normalizedCond,
        );
    }

    if ($k === 'suppress_trend') {
        $trendKeyRaw = trim(strval(isset($raw['trendKey']) ? $raw['trendKey'] : ''));
        $colonIdx = strpos($trendKeyRaw, ':');
        if ($colonIdx < 1) {
            throw new Exception('trendKey must look like trait:value.');
        }

        $tr = trim(substr($trendKeyRaw, 0, $colonIdx));
        $tv = trim(substr($trendKeyRaw, $colonIdx + 1));

        if (!in_array($tr, $TRAIT_KEYS, true) || $tv === '') {
            throw new Exception('Invalid trendKey.');
        }

        return array('trendKey' => $tr . ':' . $tv);
    }

    if ($k === 'lore_only') {
        $dogNumber = intval(isset($raw['dogNumber']) ? $raw['dogNumber'] : 0);
        $lore = trim(strval(isset($raw['lore']) ? $raw['lore'] : ''));

        if ($dogNumber < 1 || $dogNumber > 10000) {
            throw new Exception('dogNumber must be 1–10000.');
        }
        if ($lore === '') {
            throw new Exception('lore is required.');
        }
        if (strlen($lore) > 8000) {
            throw new Exception('lore is too long.');
        }

        return array('dogNumber' => $dogNumber, 'lore' => $lore);
    }

    throw new Exception('Unknown suggestion kind.');
}

function requireDdAdminPassword() {
    $expected = getExpectedDdAdminPassword();
    if ($expected === '') {
        sendError('DD admin saving is not configured. Set DD_ADMIN_PASSWORD on the server.', 503);
    }

    $body = getJsonRequestBody();
    $provided = trim(strval(
        getRequestHeader('x-dd-admin-password')
        ?: (isset($body['password']) ? $body['password'] : (isset($_POST['password']) ? $_POST['password'] : (isset($_GET['adminPassword']) ? $_GET['adminPassword'] : '')))
    ));

    if ($provided === '' || !hash_equals($expected, $provided)) {
        sendError('Invalid DD admin password.', 401);
    }
}

function normalizeImportDogNumber($value) {
    if ($value === null || $value === '') {
        return null;
    }

    if (!is_numeric($value)) {
        return null;
    }

    $dogNumber = intval($value);
    if ($dogNumber < 1 || $dogNumber > 10000) {
        return null;
    }

    return $dogNumber;
}

function normalizeImportTimestamp($value, $fallback = null) {
    if ($value === null || $value === '') {
        return $fallback;
    }

    try {
        $date = new DateTimeImmutable(strval($value));
        return $date->setTimezone(new DateTimeZone('UTC'))->format('c');
    } catch (Exception $e) {
        return $fallback;
    }
}

function parseApacheLogTimestamp($value) {
    $date = DateTimeImmutable::createFromFormat('d/M/Y:H:i:s O', strval($value));
    if (!$date) {
        return null;
    }

    return $date->setTimezone(new DateTimeZone('UTC'))->format('c');
}

function parseW3cLogTimestamp($datePart, $timePart) {
    if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', strval($datePart)) || !preg_match('/^\d{2}:\d{2}:\d{2}$/', strval($timePart))) {
        return null;
    }

    return normalizeImportTimestamp($datePart . 'T' . $timePart . 'Z', null);
}

function extractEvaluationDogNumber($text) {
    $value = strval($text);
    $matches = array();

    if (preg_match('/\/api\/dd-evaluator\/evaluate\/(\d{1,5})(?:\b|[\/?#])/i', $value, $matches)
        || preg_match('/\/api\/dd-evaluator\/evaluate\/(\d{1,5})$/i', $value, $matches)) {
        return normalizeImportDogNumber($matches[1]);
    }

    if (preg_match('/dd-evaluator(?:\.php)?[^\s"\']*(?:[?&]action=evaluate\b[^\s"\']*[?&]dogNumber=(\d{1,5})|[?&]dogNumber=(\d{1,5})[^\s"\']*[?&]action=evaluate\b)/i', $value, $matches)) {
        return normalizeImportDogNumber(isset($matches[1]) && $matches[1] !== '' ? $matches[1] : $matches[2]);
    }

    if (preg_match('/\bdogNumber=(\d{1,5})\b/i', $value, $matches) && stripos($value, 'evaluate') !== false) {
        return normalizeImportDogNumber($matches[1]);
    }

    return null;
}

function parseDdEvaluationImport($rawText, $options = array()) {
    global $DD_IMPORT_LOOKBACK_HOURS, $DD_IMPORT_MAX_EVENTS;

    $text = strval($rawText);
    $lookbackHours = max(1, min(168, intval(isset($options['lookbackHours']) ? $options['lookbackHours'] : $DD_IMPORT_LOOKBACK_HOURS)));
    $fallbackTimestamp = gmdate('c');
    $cutoffTimestamp = time() - ($lookbackHours * 3600);
    $lines = preg_split('/\r?\n/', $text);
    $events = array();
    $invalidCount = 0;
    $skippedOutsideWindow = 0;
    $w3cFields = null;

    foreach ($lines as $line) {
        $trimmed = trim($line);
        if ($trimmed === '') {
            continue;
        }

        if (preg_match('/^#Fields:/i', $trimmed)) {
            $w3cFields = preg_split('/\s+/', preg_replace('/^#Fields:\s*/i', '', $trimmed));
            continue;
        }

        if (strpos($trimmed, '#') === 0) {
            continue;
        }

        $dogNumber = null;
        $evaluatedAt = null;

        if (strpos($trimmed, '{') === 0) {
            $parsed = json_decode($trimmed, true);
            if (is_array($parsed)) {
                $dogNumber = normalizeImportDogNumber(isset($parsed['dogNumber']) ? $parsed['dogNumber'] : null);
                if ($dogNumber === null) {
                    $dogNumber = extractEvaluationDogNumber(implode(' ', array_filter(array(
                        isset($parsed['requestPath']) ? $parsed['requestPath'] : null,
                        isset($parsed['path']) ? $parsed['path'] : null,
                        isset($parsed['url']) ? $parsed['url'] : null,
                        isset($parsed['request']) ? $parsed['request'] : null,
                    ))));
                }
                $evaluatedAt = normalizeImportTimestamp(
                    isset($parsed['evaluatedAt']) ? $parsed['evaluatedAt'] : (isset($parsed['timestamp']) ? $parsed['timestamp'] : (isset($parsed['loggedAt']) ? $parsed['loggedAt'] : (isset($parsed['date']) ? $parsed['date'] : null))),
                    null
                );
            }
        }

        if ($dogNumber === null && is_array($w3cFields) && preg_match('/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\b/', $trimmed)) {
            $tokens = preg_split('/\s+/', $trimmed);
            $record = array();
            foreach ($w3cFields as $index => $field) {
                $record[$field] = isset($tokens[$index]) ? $tokens[$index] : '';
            }

            $dogNumber = extractEvaluationDogNumber((isset($record['cs-uri-stem']) ? $record['cs-uri-stem'] : '') . '?' . (isset($record['cs-uri-query']) ? $record['cs-uri-query'] : ''));
            $evaluatedAt = parseW3cLogTimestamp(isset($record['date']) ? $record['date'] : null, isset($record['time']) ? $record['time'] : null);
        }

        if ($dogNumber === null) {
            $dogNumber = extractEvaluationDogNumber($trimmed);
        }

        if ($evaluatedAt === null && preg_match('/\[([^\]]+)\]/', $trimmed, $matches)) {
            $evaluatedAt = parseApacheLogTimestamp($matches[1]);
        }

        if ($evaluatedAt === null && preg_match('/\b(\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+\-]\d{2}:?\d{2})?)\b/', $trimmed, $matches)) {
            $normalizedIso = strpos($matches[1], 'T') !== false ? $matches[1] : str_replace(' ', 'T', $matches[1]);
            if (!preg_match('/(?:Z|[+\-]\d{2}:?\d{2})$/', $normalizedIso)) {
                $normalizedIso .= 'Z';
            }
            $evaluatedAt = normalizeImportTimestamp($normalizedIso, null);
        }

        if ($dogNumber === null) {
            $invalidCount += 1;
            continue;
        }

        $normalizedEvaluatedAt = $evaluatedAt !== null ? $evaluatedAt : $fallbackTimestamp;
        $eventTimestamp = strtotime($normalizedEvaluatedAt);
        if ($eventTimestamp !== false && $eventTimestamp < $cutoffTimestamp) {
            $skippedOutsideWindow += 1;
            continue;
        }

        $events[] = array(
            'dogNumber' => $dogNumber,
            'evaluatedAt' => $normalizedEvaluatedAt,
        );

        if (count($events) > $DD_IMPORT_MAX_EVENTS) {
            throw new Exception('Import payload exceeded ' . $DD_IMPORT_MAX_EVENTS . ' matched evaluation requests. Split the log into smaller batches.');
        }
    }

    usort($events, function ($left, $right) {
        $leftTime = strtotime($left['evaluatedAt']);
        $rightTime = strtotime($right['evaluatedAt']);
        if ($leftTime === $rightTime) {
            return intval($left['dogNumber']) - intval($right['dogNumber']);
        }
        return $leftTime - $rightTime;
    });

    return array(
        'events' => $events,
        'invalidCount' => $invalidCount,
        'skippedOutsideWindow' => $skippedOutsideWindow,
        'lineCount' => count($lines),
        'lookbackHours' => $lookbackHours,
    );
}

function normalizeNumber($value) {
    if ($value === null || $value === '') {
        return null;
    }

    if (is_numeric($value)) {
        return 0 + $value;
    }

    return null;
}

/** Positive: direct multiplier; negative: (1 + m), same as Node evaluator. */
function normalize_signed_price_multiplier_php($m) {
    if ($m === null) {
        return 1.0;
    }
    $x = floatval($m);
    if (!is_finite($x) || $x == 0.0) {
        return 1.0;
    }
    if ($x > 0) {
        return max(0.01, min(100.0, $x));
    }
    return max(0.01, 1.0 + $x);
}

/** Floor-first blend on the rarest trait (mirrors _tools/dd-scraper/evaluator.js). */
function blend_rarest_trait_base_price_php(array $tb) {
    if (!empty($tb['isSynthetic'])) {
        return null;
    }
    $floor = normalizeNumber(isset($tb['floor']) ? $tb['floor'] : null);
    $saleMedian = normalizeNumber(isset($tb['saleMedian']) ? $tb['saleMedian'] : null);
    $saleFloorStat = normalizeNumber(isset($tb['saleFloor']) ? $tb['saleFloor'] : null);
    $topSale = normalizeNumber(isset($tb['topSale']) ? $tb['topSale'] : null);
    $saleCount = isset($tb['saleCount']) ? max(0, intval($tb['saleCount'])) : 0;
    $listed = isset($tb['listed']) ? max(0, intval($tb['listed'])) : 0;

    $saleSignal = null;
    if ($saleCount >= 2 && $saleMedian !== null && $saleMedian > 0) {
        $saleSignal = $saleMedian;
    } elseif ($saleMedian !== null && $saleMedian > 0) {
        $saleSignal = $saleMedian;
    } elseif ($saleFloorStat !== null && $saleFloorStat > 0) {
        $saleSignal = $saleFloorStat;
    } elseif ($topSale !== null && $topSale > 0) {
        $saleSignal = $topSale;
    }

    $hasFloor = $floor !== null && $floor > 0;
    $hasSale = $saleSignal !== null && $saleSignal > 0;

    if (!$hasFloor && !$hasSale) {
        return ($topSale !== null && $topSale > 0) ? $topSale : null;
    }
    if (!$hasFloor && $hasSale) {
        return $saleSignal;
    }
    if ($hasFloor && !$hasSale) {
        return $floor;
    }

    $wFloor = 0.58 + min($listed, 12) * 0.022 - min($saleCount, 12) * 0.028;
    if ($wFloor < 0.28) {
        $wFloor = 0.28;
    }
    if ($wFloor > 0.78) {
        $wFloor = 0.78;
    }

    $blended = $wFloor * $floor + (1.0 - $wFloor) * $saleSignal;

    if ($topSale !== null && $topSale > $floor) {
        $excess = $topSale - $floor;
        $capFrac = 0.42;
        if ($saleCount >= 10) {
            $capFrac = 0.72;
        } elseif ($saleCount >= 5) {
            $capFrac = 0.58;
        } elseif ($saleCount >= 2) {
            $capFrac = 0.48;
        }
        $ceiling = $floor + $excess * $capFrac;
        if ($blended > $ceiling) {
            $blended = $ceiling;
        }
    }

    if (!is_finite($blended) || $blended <= 0) {
        $fallback = $floor;
        if ($saleSignal > $fallback) {
            $fallback = $saleSignal;
        }
        if ($topSale !== null && $topSale > $fallback) {
            $fallback = $topSale;
        }
        return $fallback > 0 ? $fallback : null;
    }
    return $blended;
}

/** Rarest trait anchor trait count &lt;100 and no listing/sale rows in snapshot — matches Node evaluator. */
function qualifies_rarest_trait_thin_market_boost_php(array $tb) {
    if (!empty($tb['isSynthetic'])) {
        return false;
    }
    $tc = isset($tb['traitCount']) ? $tb['traitCount'] : null;
    if ($tc === null || intval($tc) >= 100) {
        return false;
    }
    $listed = isset($tb['listed']) ? intval($tb['listed']) : 0;
    $saleCount = isset($tb['saleCount']) ? intval($tb['saleCount']) : 0;
    return $listed === 0 && $saleCount === 0;
}

/**
 * Top-N rarest layers (by supply <= maxSupply): base = max(blend each). Mirrors evaluator.js.
 *
 * @return array{basePriceDoge: float|null, compoundRows: array, winningTrait: ?array, compoundIndices: array<int, true>}
 */
function compute_compound_anchor_base_php(array $traitBreakdown) {
    $maxN = 3;
    $maxSupply = 2500;
    $eligible = array();
    foreach ($traitBreakdown as $i => $tb) {
        if (!empty($tb['isSynthetic'])) {
            continue;
        }
        if (!isset($tb['traitCount']) || $tb['traitCount'] === null) {
            continue;
        }
        if (intval($tb['traitCount']) > $maxSupply) {
            continue;
        }
        $eligible[] = array('idx' => $i, 'tb' => $tb);
    }
    usort($eligible, function ($a, $b) {
        $ca = intval($a['tb']['traitCount']);
        $cb = intval($b['tb']['traitCount']);
        if ($ca !== $cb) {
            return $ca - $cb;
        }
        return strcmp($a['tb']['trait'], $b['tb']['trait']);
    });
    $slice = array_slice($eligible, 0, $maxN);
    $withBlends = array();
    $compoundRows = array();
    $basePriceDoge = null;
    foreach ($slice as $item) {
        $tb = $item['tb'];
        $blend = blend_rarest_trait_base_price_php($tb);
        $withBlends[] = array('tb' => $tb, 'blend' => $blend);
        $compoundRows[] = array(
            'trait' => $tb['trait'],
            'value' => $tb['value'],
            'count' => $tb['traitCount'],
            'blendDoge' => ($blend !== null && $blend > 0) ? intval(round($blend)) : null,
        );
        if ($blend !== null && $blend > 0 && ($basePriceDoge === null || $blend > $basePriceDoge)) {
            $basePriceDoge = $blend;
        }
    }
    $winningTrait = null;
    if ($basePriceDoge !== null) {
        foreach ($withBlends as $wb) {
            if ($wb['blend'] !== null && abs(floatval($wb['blend']) - floatval($basePriceDoge)) < 1e-9) {
                $winningTrait = $wb['tb'];
                break;
            }
        }
    }
    $compoundIndices = array();
    foreach ($slice as $item) {
        $compoundIndices[intval($item['idx'])] = true;
    }
    return array(
        'basePriceDoge' => $basePriceDoge,
        'compoundRows' => $compoundRows,
        'winningTrait' => $winningTrait,
        'compoundIndices' => $compoundIndices,
        'maxTraits' => $maxN,
        'maxSupply' => $maxSupply,
    );
}

/** Default dog # vanity multipliers (merged when trendNumbers omitted in config). */
function default_angel_trend_numbers_map() {
    return array(
        '1' => array('enabled' => true, 'multiplier' => 1.20),
        '10' => array('enabled' => true, 'multiplier' => 1.06),
        '13' => array('enabled' => true, 'multiplier' => 1.05),
        '21' => array('enabled' => true, 'multiplier' => 1.05),
        '42' => array('enabled' => true, 'multiplier' => 1.10),
        '67' => array('enabled' => true, 'multiplier' => 1.12),
        '69' => array('enabled' => true, 'multiplier' => 1.20),
        '96' => array('enabled' => true, 'multiplier' => 1.07),
        '100' => array('enabled' => true, 'multiplier' => 1.06),
        '111' => array('enabled' => true, 'multiplier' => 1.14),
        '123' => array('enabled' => true, 'multiplier' => 1.09),
        '222' => array('enabled' => true, 'multiplier' => 1.14),
        '234' => array('enabled' => true, 'multiplier' => 1.06),
        '321' => array('enabled' => true, 'multiplier' => 1.08),
        '333' => array('enabled' => true, 'multiplier' => 1.15),
        '420' => array('enabled' => true, 'multiplier' => 1.20),
        '555' => array('enabled' => true, 'multiplier' => 1.10),
        '666' => array('enabled' => true, 'multiplier' => 1.19),
        '777' => array('enabled' => true, 'multiplier' => 1.14),
        '888' => array('enabled' => true, 'multiplier' => 1.14),
        '999' => array('enabled' => true, 'multiplier' => 1.14),
        '1000' => array('enabled' => true, 'multiplier' => 1.07),
        '1111' => array('enabled' => true, 'multiplier' => 1.12),
        '1234' => array('enabled' => true, 'multiplier' => 1.16),
        '1337' => array('enabled' => true, 'multiplier' => 1.18),
        '2222' => array('enabled' => true, 'multiplier' => 1.12),
        '2345' => array('enabled' => true, 'multiplier' => 1.12),
        '2468' => array('enabled' => true, 'multiplier' => 1.08),
        '3000' => array('enabled' => true, 'multiplier' => 1.06),
        '3333' => array('enabled' => true, 'multiplier' => 1.14),
        '3456' => array('enabled' => true, 'multiplier' => 1.17),
        '4321' => array('enabled' => true, 'multiplier' => 1.13),
        '4444' => array('enabled' => true, 'multiplier' => 1.11),
        '4567' => array('enabled' => true, 'multiplier' => 1.18),
        '5432' => array('enabled' => true, 'multiplier' => 1.11),
        '5555' => array('enabled' => true, 'multiplier' => 1.10),
        '5678' => array('enabled' => true, 'multiplier' => 1.18),
        '6666' => array('enabled' => true, 'multiplier' => 1.12),
        '6789' => array('enabled' => true, 'multiplier' => 1.19),
        '7777' => array('enabled' => true, 'multiplier' => 1.13),
        '8888' => array('enabled' => true, 'multiplier' => 1.13),
        '9876' => array('enabled' => true, 'multiplier' => 1.14),
        '9999' => array('enabled' => true, 'multiplier' => 1.15),
        '10000' => array('enabled' => true, 'multiplier' => 1.20),
    );
}

function validateDogNumber($raw) {
    if (!isset($raw) || !ctype_digit(strval($raw))) {
        sendError('Invalid dog number. Must be 1-10000.');
    }

    $num = intval($raw);
    if ($num < 1 || $num > 10000) {
        sendError('Invalid dog number. Must be 1-10000.');
    }

    return $num;
}

function validateWalletAddress($raw) {
    $address = trim(strval($raw));

    if ($address === '' || !preg_match('/^[A-Za-z0-9]{24,80}$/', $address)) {
        sendError('Invalid wallet address.');
    }

    return $address;
}

function traitCategoryLabel($key) {
    if ($key === 'furColor') {
        return 'Fur Color';
    }
    if ($key === 'furPattern') {
        return 'Fur Pattern';
    }
    return ucfirst($key);
}

function normalizeCatalogTraits($traits) {
    if (!is_array($traits)) {
        return null;
    }

    $rank = isset($traits['rarityRank']) ? normalizeNumber($traits['rarityRank']) : null;
    $traits['rarityRank'] = $rank !== null ? intval($rank) : null;

    if (!isset($traits['traitCounts']) || !is_array($traits['traitCounts'])) {
        $traits['traitCounts'] = array();
    }

    return $traits;
}

function getDogCatalog() {
    static $loaded = false;
    static $catalog = null;

    if ($loaded) {
        return $catalog;
    }

    global $catalogDisabled;
    if ($catalogDisabled && preg_match('/^(1|true|yes)$/i', strval($catalogDisabled))) {
        $loaded = true;
        return $catalog;
    }

    global $CATALOG_CANDIDATE_PATHS;

    foreach ($CATALOG_CANDIDATE_PATHS as $path) {
        if (!$path || !is_file($path)) {
            continue;
        }

        $raw = @file_get_contents($path);
        if ($raw === false) {
            continue;
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded) && isset($decoded['dogs']) && is_array($decoded['dogs'])) {
            $catalog = $decoded;
            break;
        }
    }

    $loaded = true;
    return $catalog;
}

function getCatalogDogTraits($dogNumber) {
    $catalog = getDogCatalog();
    if (!is_array($catalog) || !isset($catalog['dogs']) || !is_array($catalog['dogs'])) {
        return null;
    }

    $entry = null;
    $stringKey = strval($dogNumber);
    if (isset($catalog['dogs'][$stringKey]) && is_array($catalog['dogs'][$stringKey])) {
        $entry = $catalog['dogs'][$stringKey];
    } elseif (isset($catalog['dogs'][$dogNumber]) && is_array($catalog['dogs'][$dogNumber])) {
        $entry = $catalog['dogs'][$dogNumber];
    }

    if (!is_array($entry) || (isset($entry['ok']) && !$entry['ok']) || !isset($entry['traits']) || !is_array($entry['traits'])) {
        return null;
    }

    return normalizeCatalogTraits($entry['traits']);
}

function getCatalogTraitCounts() {
    static $loaded = false;
    static $counts = array();

    if ($loaded) {
        return $counts;
    }

    $catalog = getDogCatalog();
    if (!is_array($catalog) || !isset($catalog['dogs']) || !is_array($catalog['dogs'])) {
        $loaded = true;
        return $counts;
    }

    global $TRAIT_KEYS;
    foreach ($TRAIT_KEYS as $key) {
        $counts[traitCategoryLabel($key)] = array();
    }

    foreach ($catalog['dogs'] as $entry) {
        if (!is_array($entry) || (isset($entry['ok']) && !$entry['ok']) || !isset($entry['traits']) || !is_array($entry['traits'])) {
            continue;
        }

        $traits = normalizeCatalogTraits($entry['traits']);
        if (!is_array($traits)) {
            continue;
        }

        foreach ($TRAIT_KEYS as $key) {
            $value = isset($traits[$key]) ? $traits[$key] : null;
            if ($value === null || $value === '') {
                continue;
            }

            $category = traitCategoryLabel($key);
            if (!isset($counts[$category][$value])) {
                $counts[$category][$value] = 0;
            }
            $counts[$category][$value] += 1;
        }
    }

    $loaded = true;
    return $counts;
}

function meanValue($values) {
    if (!is_array($values) || count($values) === 0) {
        return null;
    }

    return array_sum($values) / count($values);
}

function medianValue($values) {
    if (!is_array($values) || count($values) === 0) {
        return null;
    }

    $sorted = array_values($values);
    sort($sorted);
    $count = count($sorted);
    $mid = intval(floor($count / 2));

    if ($count % 2 === 1) {
        return $sorted[$mid];
    }

    return ($sorted[$mid - 1] + $sorted[$mid]) / 2;
}

function getDefaultTrendingConfig() {
    return array(
        'manualMultipliers' => array(
            'head:Wizard' => 1.5,
            'head:Beret' => 1.25,
            'clothes:Suit' => 1.5,
        ),
        'refusedOffers' => array(),
        'autoTrend' => array(
            'enabled' => true,
            'maxTraitCount' => 800,
            'minSaleCount' => 2,
            'minSalesPercent' => 0.005,
            'saleWeight' => 0.06,
            'salesPercentWeight' => 10,
            'listingWeight' => 1.5,
            'maxMultiplier' => 2.5,
            'disabledTrendKeys' => array(),
        ),
        'specialMultipliers' => array(
            'colorMatch' => array('enabled' => true, 'multiplier' => 1.10),
            'minimalTiers' => array(
                'black_classic_visor' => array('enabled' => true, 'multiplier' => 1.20),
                'black_classic'       => array('enabled' => true, 'multiplier' => 1.15),
                'visor_minimal'       => array('enabled' => true, 'multiplier' => 1.15),
                'ultra_clean'         => array('enabled' => true, 'multiplier' => 1.10),
                'minimal_1'           => array('enabled' => true, 'multiplier' => 1.05),
                'minimal_2'           => array('enabled' => true, 'multiplier' => 1.01),
            ),
            'combos' => array(),
        ),
        'updatedAt' => null,
        'updatedBy' => 'system',
    );
}

function normalizeTrendKeyList($value) {
    $values = array();
    if (is_array($value)) {
        $isList = array_keys($value) === range(0, count($value) - 1);
        if ($isList) {
            $values = $value;
        } else {
            foreach ($value as $key => $enabled) {
                if ($enabled) {
                    $values[] = $key;
                }
            }
        }
    }

    $trendKeys = array();
    foreach ($values as $rawValue) {
        $trendKey = trim(strval($rawValue));
        if ($trendKey === '' || in_array($trendKey, $trendKeys, true)) {
            continue;
        }
        $trendKeys[] = $trendKey;
    }

    return $trendKeys;
}

function normalizeSpecialMultipliers($raw) {
    $tierDefaults = array(
        'black_classic_visor' => 1.20,
        'black_classic'       => 1.15,
        'visor_minimal'       => 1.15,
        'ultra_clean'         => 1.10,
        'minimal_1'           => 1.05,
        'minimal_2'           => 1.01,
    );

    $cmRaw = isset($raw['colorMatch']) && is_array($raw['colorMatch']) ? $raw['colorMatch'] : array();
    $colorMatch = array(
        'enabled'    => !isset($cmRaw['enabled']) || (bool)$cmRaw['enabled'],
        'multiplier' => max(1.0, isset($cmRaw['multiplier']) ? floatval($cmRaw['multiplier']) : 1.10),
    );

    $tiersSource = isset($raw['minimalTiers']) && is_array($raw['minimalTiers']) ? $raw['minimalTiers'] : array();
    $minimalTiers = array();
    foreach ($tierDefaults as $id => $def) {
        $entry = isset($tiersSource[$id]) && is_array($tiersSource[$id]) ? $tiersSource[$id] : array();
        $minimalTiers[$id] = array(
            'enabled'    => !isset($entry['enabled']) || (bool)$entry['enabled'],
            'multiplier' => max(1.0, isset($entry['multiplier']) ? floatval($entry['multiplier']) : $def),
        );
    }

    $combosSource = isset($raw['combos']) && is_array($raw['combos']) ? $raw['combos'] : array();
    $combos = array();
    foreach ($combosSource as $combo) {
        if (!is_array($combo)) continue;
        $conditions = isset($combo['conditions']) && is_array($combo['conditions']) ? $combo['conditions'] : array();
        $validConditions = array();
        foreach ($conditions as $cond) {
            if (!is_array($cond) || !isset($cond['trait']) || !isset($cond['value'])) continue;
            $validConditions[] = array(
                'trait' => strval($cond['trait']),
                'op'    => (isset($cond['op']) && $cond['op'] === 'contains') ? 'contains' : 'eq',
                'value' => strval($cond['value']),
            );
        }
        if (empty($validConditions)) {
            continue;
        }
        $multiplierRaw = isset($combo['multiplier']) ? floatval($combo['multiplier']) : 0.0;
        if (!is_finite($multiplierRaw) || $multiplierRaw == 0.0) {
            continue;
        }
        $combos[] = array(
            'id'         => isset($combo['id']) ? strval($combo['id']) : '',
            'label'      => isset($combo['label']) ? strval($combo['label']) : '',
            'conditions' => $validConditions,
            'multiplier' => $multiplierRaw,
            'enabled'    => !isset($combo['enabled']) || (bool)$combo['enabled'],
        );
    }

    $angelRaw = isset($raw['angelNumbers']) && is_array($raw['angelNumbers']) ? $raw['angelNumbers'] : array();
    $trendRaw = (isset($angelRaw['trendNumbers']) && is_array($angelRaw['trendNumbers']))
        ? $angelRaw['trendNumbers']
        : null;
    $trendSource = $trendRaw !== null ? $trendRaw : default_angel_trend_numbers_map();
    $trendNumbers = array();
    foreach ($trendSource as $key => $entry) {
        if (!is_array($entry)) {
            continue;
        }
        $n = intval($key);
        if ($n < 1 || $n > 10000) {
            continue;
        }
        $sk = strval($n);
        $mult = isset($entry['multiplier']) ? floatval($entry['multiplier']) : 1.05;
        $mult = max(1.0, min(1.2, $mult));
        $trendNumbers[$sk] = array(
            'enabled'    => !isset($entry['enabled']) || (bool)$entry['enabled'],
            'multiplier' => $mult,
        );
    }

    $angelNumbers = array(
        'quadRepeater' => array(
            'enabled'    => !isset($angelRaw['quadRepeater']['enabled']) || (bool)$angelRaw['quadRepeater']['enabled'],
            'multiplier' => max(1.0, isset($angelRaw['quadRepeater']['multiplier']) ? floatval($angelRaw['quadRepeater']['multiplier']) : 1.25),
        ),
        'tripleRepeater' => array(
            'enabled'    => !isset($angelRaw['tripleRepeater']['enabled']) || (bool)$angelRaw['tripleRepeater']['enabled'],
            'multiplier' => max(1.0, isset($angelRaw['tripleRepeater']['multiplier']) ? floatval($angelRaw['tripleRepeater']['multiplier']) : 1.15),
        ),
        'trendNumbers' => $trendNumbers,
    );

    return array(
        'colorMatch'   => $colorMatch,
        'minimalTiers' => $minimalTiers,
        'combos'       => $combos,
        'angelNumbers' => $angelNumbers,
    );
}

function normalizeTrendingConfig($raw) {
    $defaults = getDefaultTrendingConfig();
    $manualSource = isset($raw['manualMultipliers']) && is_array($raw['manualMultipliers'])
        ? $raw['manualMultipliers']
        : $defaults['manualMultipliers'];
    $manualMultipliers = array();

    foreach ($manualSource as $key => $value) {
        $number = normalizeNumber($value);
        if ($number !== null && $number >= 1) {
            $manualMultipliers[$key] = round($number, 4);
        }
    }

    $refusedSource = isset($raw['refusedOffers']) && is_array($raw['refusedOffers'])
        ? $raw['refusedOffers']
        : $defaults['refusedOffers'];
    $refusedOffers = array();
    foreach ($refusedSource as $dogNumber => $value) {
        $normalizedDogNumber = intval($dogNumber);
        if ($normalizedDogNumber < 1 || $normalizedDogNumber > 10000) {
            continue;
        }

        $entry = null;
        if (is_array($value)) {
            $minOfferUsd = normalizeNumber(isset($value['minOfferUsd']) ? $value['minOfferUsd'] : null);
            $minOfferDoge = normalizeNumber(isset($value['minOfferDoge']) ? $value['minOfferDoge'] : null);
            if (($minOfferUsd !== null && $minOfferUsd > 0) || ($minOfferDoge !== null && $minOfferDoge > 0)) {
                $entry = array(
                    'dogNumber' => $normalizedDogNumber,
                    'minOfferUsd' => ($minOfferUsd !== null && $minOfferUsd > 0) ? round($minOfferUsd, 2) : null,
                    'minOfferDoge' => ($minOfferDoge !== null && $minOfferDoge > 0) ? intval(round($minOfferDoge)) : null,
                    'note' => isset($value['note']) && trim(strval($value['note'])) !== '' ? trim(strval($value['note'])) : null,
                    'updatedAt' => isset($value['updatedAt']) ? $value['updatedAt'] : null,
                    'updatedBy' => isset($value['updatedBy']) ? $value['updatedBy'] : null,
                );
            }
        } else {
            $minOfferDoge = normalizeNumber($value);
            if ($minOfferDoge !== null && $minOfferDoge > 0) {
                $entry = array(
                    'dogNumber' => $normalizedDogNumber,
                    'minOfferDoge' => intval(round($minOfferDoge)),
                    'note' => null,
                    'updatedAt' => null,
                    'updatedBy' => null,
                );
            }
        }

        if ($entry !== null) {
            $refusedOffers[strval($normalizedDogNumber)] = $entry;
        }
    }

    $autoSource = isset($raw['autoTrend']) && is_array($raw['autoTrend'])
        ? $raw['autoTrend']
        : $defaults['autoTrend'];
    $autoTrend = array(
        'enabled' => !isset($autoSource['enabled']) || !!$autoSource['enabled'],
        'maxTraitCount' => max(1, intval(isset($autoSource['maxTraitCount']) ? $autoSource['maxTraitCount'] : $defaults['autoTrend']['maxTraitCount'])),
        'minSaleCount' => max(1, intval(isset($autoSource['minSaleCount']) ? $autoSource['minSaleCount'] : $defaults['autoTrend']['minSaleCount'])),
        'minSalesPercent' => max(0, floatval(isset($autoSource['minSalesPercent']) ? $autoSource['minSalesPercent'] : $defaults['autoTrend']['minSalesPercent'])),
        'saleWeight' => max(0, floatval(isset($autoSource['saleWeight']) ? $autoSource['saleWeight'] : $defaults['autoTrend']['saleWeight'])),
        'salesPercentWeight' => max(0, floatval(isset($autoSource['salesPercentWeight']) ? $autoSource['salesPercentWeight'] : $defaults['autoTrend']['salesPercentWeight'])),
        'listingWeight' => max(0, floatval(isset($autoSource['listingWeight']) ? $autoSource['listingWeight'] : $defaults['autoTrend']['listingWeight'])),
        'maxMultiplier' => max(1, floatval(isset($autoSource['maxMultiplier']) ? $autoSource['maxMultiplier'] : $defaults['autoTrend']['maxMultiplier'])),
        'disabledTrendKeys' => normalizeTrendKeyList(isset($autoSource['disabledTrendKeys']) ? $autoSource['disabledTrendKeys'] : array()),
    );

    return array(
        'manualMultipliers' => $manualMultipliers,
        'refusedOffers' => $refusedOffers,
        'autoTrend' => $autoTrend,
        'specialMultipliers' => normalizeSpecialMultipliers(
            isset($raw['specialMultipliers']) && is_array($raw['specialMultipliers']) ? $raw['specialMultipliers'] : array()
        ),
        'updatedAt' => isset($raw['updatedAt']) ? $raw['updatedAt'] : $defaults['updatedAt'],
        'updatedBy' => isset($raw['updatedBy']) ? $raw['updatedBy'] : $defaults['updatedBy'],
    );
}

function getTrendingConfigData($forceReload = false) {
    static $loaded = false;
    static $config = null;

    if ($forceReload) {
        $loaded = false;
        $config = null;
    }

    if ($loaded) {
        return $config;
    }

    global $TRENDING_CONFIG_CANDIDATE_PATHS;
    foreach ($TRENDING_CONFIG_CANDIDATE_PATHS as $path) {
        if (!$path || !is_file($path)) {
            continue;
        }

        $raw = @file_get_contents($path);
        if ($raw === false) {
            continue;
        }

        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $config = normalizeTrendingConfig($decoded);
            $loaded = true;
            return $config;
        }
    }

    $config = normalizeTrendingConfig(getDefaultTrendingConfig());
    $loaded = true;
    return $config;
}

function buildTrendingSummary($traitStats, $saleTraitStats, $traitMeta) {
    global $TRAIT_KEYS;

    $config = getTrendingConfigData();
    $manualMultipliers = array();
    foreach ($config['manualMultipliers'] as $key => $value) {
        $number = normalizeNumber($value);
        if ($number !== null && $number >= 1) {
            $manualMultipliers[$key] = round($number, 4);
        }
    }

    $autoMultipliers = array();
    $autoConfig = isset($config['autoTrend']) && is_array($config['autoTrend']) ? $config['autoTrend'] : getDefaultTrendingConfig()['autoTrend'];
    $suppressedTrendKeys = array_flip(isset($autoConfig['disabledTrendKeys']) && is_array($autoConfig['disabledTrendKeys']) ? $autoConfig['disabledTrendKeys'] : array());
    $counts = isset($traitMeta['counts']) && is_array($traitMeta['counts']) ? $traitMeta['counts'] : array();

    if (!empty($autoConfig['enabled'])) {
        foreach ($TRAIT_KEYS as $traitKey) {
            $category = traitCategoryLabel($traitKey);
            $values = isset($counts[$category]) && is_array($counts[$category]) ? $counts[$category] : array();

            foreach ($values as $value => $count) {
                $traitCount = intval($count);
                if ($traitCount < 1 || $traitCount > intval($autoConfig['maxTraitCount'])) {
                    continue;
                }

                $saleCount = isset($saleTraitStats[$traitKey][$value]['count']) ? intval($saleTraitStats[$traitKey][$value]['count']) : 0;
                $listedCount = isset($traitStats[$traitKey][$value]['listed']) ? intval($traitStats[$traitKey][$value]['listed']) : 0;
                $salesPercent = $traitCount > 0 ? ($saleCount / $traitCount) : 0;
                $listedPercent = $traitCount > 0 ? ($listedCount / $traitCount) : 0;

                if ($saleCount < intval($autoConfig['minSaleCount']) && $salesPercent < floatval($autoConfig['minSalesPercent'])) {
                    continue;
                }

                $multiplier = 1
                    + ($saleCount * floatval($autoConfig['saleWeight']))
                    + ($salesPercent * floatval($autoConfig['salesPercentWeight']))
                    + ($listedPercent * floatval($autoConfig['listingWeight']));
                $multiplier = min(floatval($autoConfig['maxMultiplier']), round($multiplier, 2));
                if ($multiplier <= 1) {
                    continue;
                }

                $autoMultipliers[$traitKey . ':' . $value] = array(
                    'multiplier' => $multiplier,
                    'saleCount' => $saleCount,
                    'salesPercent' => round($salesPercent, 4),
                    'listedCount' => $listedCount,
                    'listedPercent' => round($listedPercent, 4),
                    'traitCount' => $traitCount,
                );
            }
        }
    }

    $effectiveMultipliers = array();
    $keys = array_unique(array_merge(array_keys($manualMultipliers), array_keys($autoMultipliers)));
    foreach ($keys as $key) {
        $manual = isset($manualMultipliers[$key]) ? $manualMultipliers[$key] : null;
        $auto = isset($autoMultipliers[$key]['multiplier']) ? $autoMultipliers[$key]['multiplier'] : null;
        $multiplier = $manual !== null ? $manual : (!isset($suppressedTrendKeys[$key]) ? $auto : null);
        if ($multiplier === null) {
            continue;
        }

        $entry = array(
            'saleCount' => isset($autoMultipliers[$key]['saleCount']) ? $autoMultipliers[$key]['saleCount'] : null,
            'salesPercent' => isset($autoMultipliers[$key]['salesPercent']) ? $autoMultipliers[$key]['salesPercent'] : null,
            'listedCount' => isset($autoMultipliers[$key]['listedCount']) ? $autoMultipliers[$key]['listedCount'] : null,
            'listedPercent' => isset($autoMultipliers[$key]['listedPercent']) ? $autoMultipliers[$key]['listedPercent'] : null,
            'traitCount' => isset($autoMultipliers[$key]['traitCount']) ? $autoMultipliers[$key]['traitCount'] : null,
            'multiplier' => $multiplier,
            'manualMultiplier' => $manual,
            'autoMultiplier' => $auto,
            'source' => $manual !== null ? 'manual' : 'auto',
        );

        $effectiveMultipliers[$key] = $entry;
    }

    return array(
        'config' => $config,
        'manualMultipliers' => $manualMultipliers,
        'autoMultipliers' => $autoMultipliers,
        'effectiveMultipliers' => $effectiveMultipliers,
    );
}

function updateTrendingConfigData($nextConfig = array()) {
    global $TRENDING_CONFIG_CANDIDATE_PATHS;

    $current = getTrendingConfigData(true);
    $updatedAt = gmdate('c');
    $updatedBy = isset($nextConfig['updatedBy']) && trim(strval($nextConfig['updatedBy'])) !== ''
        ? trim(strval($nextConfig['updatedBy']))
        : (isset($current['updatedBy']) ? $current['updatedBy'] : 'admin');

    $nextRefusedOffers = isset($nextConfig['refusedOffers']) && is_array($nextConfig['refusedOffers'])
        ? array()
        : (isset($current['refusedOffers']) && is_array($current['refusedOffers']) ? $current['refusedOffers'] : array());

    if (isset($nextConfig['refusedOffers']) && is_array($nextConfig['refusedOffers'])) {
        foreach ($nextConfig['refusedOffers'] as $dogNumber => $value) {
            $currentEntry = isset($current['refusedOffers'][strval($dogNumber)]) && is_array($current['refusedOffers'][strval($dogNumber)])
                ? $current['refusedOffers'][strval($dogNumber)]
                : array();
            $nextEntry = is_array($value) ? $value : array('minOfferDoge' => $value);
            $nextEntry['updatedAt'] = $updatedAt;
            $nextEntry['updatedBy'] = $updatedBy;
            $nextRefusedOffers[strval($dogNumber)] = array_merge($currentEntry, $nextEntry);
        }
    }

    $normalized = normalizeTrendingConfig(array(
        'manualMultipliers' => array_key_exists('manualMultipliers', $nextConfig)
            ? $nextConfig['manualMultipliers']
            : (isset($current['manualMultipliers']) ? $current['manualMultipliers'] : array()),
        'refusedOffers' => $nextRefusedOffers,
        'autoTrend' => array_merge(
            isset($current['autoTrend']) && is_array($current['autoTrend']) ? $current['autoTrend'] : array(),
            isset($nextConfig['autoTrend']) && is_array($nextConfig['autoTrend']) ? $nextConfig['autoTrend'] : array()
        ),
        'specialMultipliers' => array_key_exists('specialMultipliers', $nextConfig) && is_array($nextConfig['specialMultipliers'])
            ? $nextConfig['specialMultipliers']
            : (isset($current['specialMultipliers']) ? $current['specialMultipliers'] : array()),
        'updatedAt' => $updatedAt,
        'updatedBy' => $updatedBy,
    ));

    $path = null;
    foreach ($TRENDING_CONFIG_CANDIDATE_PATHS as $candidatePath) {
        if ($candidatePath && is_file($candidatePath) && is_writable($candidatePath)) {
            $path = $candidatePath;
            break;
        }
    }

    if ($path === null) {
        $path = count($TRENDING_CONFIG_CANDIDATE_PATHS) > 0 ? $TRENDING_CONFIG_CANDIDATE_PATHS[0] : null;
    }

    if (!$path) {
        throw new Exception('No DD trending config path is configured.');
    }

    $dir = dirname($path);
    if (!is_dir($dir) && !@mkdir($dir, 0777, true) && !is_dir($dir)) {
        throw new Exception('Could not create the DD trending config directory.');
    }

    $encoded = json_encode($normalized, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
    if ($encoded === false || @file_put_contents($path, $encoded . PHP_EOL, LOCK_EX) === false) {
        throw new Exception('Failed to write DD trending config.');
    }

    return getTrendingConfigData(true);
}

function rarityLabel($rank) {
    if (!$rank) {
        return 'Unknown';
    }
    if ($rank <= 100) {
        return 'Mythic';
    }
    if ($rank <= 500) {
        return 'Legendary';
    }
    if ($rank <= 1500) {
        return 'Rare';
    }
    if ($rank <= 4000) {
        return 'Notable';
    }
    if ($rank <= 7000) {
        return 'Collector';
    }
    return 'Classic';
}

function trpcData($procedure, $input, $label) {
    global $MARKET_BASE;

    $url = buildTrpcUrl($MARKET_BASE, $procedure, $input);
    $result = fetchUrl($url);
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || $result['body'] === '') {
        $detail = $result['error'] ? $result['error'] : 'HTTP ' . $result['httpCode'];
        throw new Exception('Upstream ' . $label . ' failed: ' . $detail);
    }

    $decoded = json_decode($result['body'], true);
    if (!is_array($decoded) || !isset($decoded[0]['result']['data']['json'])) {
        throw new Exception('Upstream ' . $label . ' returned an unexpected payload.');
    }

    return $decoded[0]['result']['data']['json'];
}

function getSearchResult($dogNumber) {
    static $cache = array();
    if (array_key_exists($dogNumber, $cache)) {
        return $cache[$dogNumber];
    }

    $data = trpcData('search.search', array('query' => strval($dogNumber), 'limit' => 1), 'search');
    $results = isset($data['results']) && is_array($data['results']) ? $data['results'] : array();

    foreach ($results as $item) {
        if (isset($item['dogId']) && intval($item['dogId']) === $dogNumber) {
            $cache[$dogNumber] = $item;
            return $cache[$dogNumber];
        }
    }

    $cache[$dogNumber] = null;
    return $cache[$dogNumber];
}

function getDogTraitsRecord($dogNumber) {
    static $cache = array();
    if (array_key_exists($dogNumber, $cache)) {
        return $cache[$dogNumber];
    }

    $catalogTraits = getCatalogDogTraits($dogNumber);
    if (is_array($catalogTraits)) {
        $cache[$dogNumber] = $catalogTraits;
        return $cache[$dogNumber];
    }

    $data = trpcData('wallet.getDogTraits', array('dogNumber' => $dogNumber), 'traits');
    $cache[$dogNumber] = is_array($data) ? $data : null;
    return $cache[$dogNumber];
}

function getDogecoinPrice() {
    static $loaded = false;
    static $value = null;

    if ($loaded) {
        return $value;
    }

    $value = normalizeNumber(trpcData('wallet.getDogecoinPrice', null, 'dogecoin price'));
    $loaded = true;
    return $value;
}

function getFloorListing($filters = null) {
    static $cache = array();
    $input = array(
        'limit' => 1,
        'sortBy' => 'price',
        'sortOrder' => 'asc'
    );

    if (is_array($filters) && count($filters) > 0) {
        $input['filters'] = $filters;
    }

    $cacheKey = md5(json_encode($input));
    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $data = trpcData('listings.getAll', $input, 'listings');
    $listings = isset($data['listings']) && is_array($data['listings']) ? $data['listings'] : array();
    $cache[$cacheKey] = count($listings) > 0 ? $listings[0] : null;
    return $cache[$cacheKey];
}

function getRecentSales($limit = 100) {
    static $cache = array();
    if (array_key_exists($limit, $cache)) {
        return $cache[$limit];
    }

    $data = trpcData('activity.getGlobal', array('limit' => $limit), 'activity');
    $activities = isset($data['activities']) && is_array($data['activities']) ? $data['activities'] : array();
    $sales = array();
    foreach ($activities as $a) {
        if (isset($a['activityType']) && $a['activityType'] === 'sale') {
            $dogNumber = null;
            if (isset($a['dogName']) && preg_match('/#(\d+)/', $a['dogName'], $m)) {
                $dogNumber = intval($m[1]);
            }
            $price = normalizeNumber(isset($a['priceDoge']) ? $a['priceDoge'] : null);
            if ($dogNumber !== null && $price !== null && $price > 0) {
                $sales[] = array('dogNumber' => $dogNumber, 'priceDoge' => $price);
            }
        }
    }
    $cache[$limit] = $sales;
    return $cache[$limit];
}

function toUsdValue($value, $dogeUsd) {
    if ($value === null || $dogeUsd === null) {
        return null;
    }

    return round($value * $dogeUsd, 2);
}

function buildDogImageUrl($dogNumber) {
    if ($dogNumber === null || $dogNumber < 1) {
        return null;
    }

    return '/api/doginal-proxy.php?action=image&dogNumber=' . intval($dogNumber);
}

function normalizeSaleActivityState($sale) {
    $confirmedAt = isset($sale['confirmedAt']) && trim(strval($sale['confirmedAt'])) !== ''
        ? strval($sale['confirmedAt'])
        : null;
    $fallbackDate = isset($sale['createdAt']) ? $sale['createdAt'] : (isset($sale['date']) ? $sale['date'] : null);
    $saleDate = $confirmedAt !== null ? $confirmedAt : $fallbackDate;

    return array(
        'status' => 'sale',
        'confirmedAt' => $saleDate,
        'date' => $saleDate,
        'isConfirmed' => true,
    );
}

function selectTopSales($sales, $limit) {
    $sorted = is_array($sales) ? array_values($sales) : array();
    usort($sorted, function ($left, $right) {
        return intval(isset($right['priceDoge']) ? $right['priceDoge'] : 0) - intval(isset($left['priceDoge']) ? $left['priceDoge'] : 0);
    });

    return array_slice($sorted, 0, $limit);
}

function getActiveListings($limit = 6) {
    static $cache = array();
    $limit = max(1, min(12, intval($limit)));

    if (array_key_exists($limit, $cache)) {
        return $cache[$limit];
    }

    $data = trpcData('listings.getAll', array(
        'limit' => $limit,
        'sortBy' => 'price',
        'sortOrder' => 'asc'
    ), 'listings');
    $rawListings = isset($data['listings']) && is_array($data['listings']) ? $data['listings'] : array();
    $offers = array();

    foreach ($rawListings as $listing) {
        $dogNumber = null;
        if (isset($listing['dogName']) && preg_match('/#(\d+)/', $listing['dogName'], $matches)) {
            $dogNumber = intval($matches[1]);
        }

        $offers[] = array(
            'dogNumber' => $dogNumber,
            'name' => isset($listing['dogName']) ? $listing['dogName'] : ($dogNumber !== null ? 'Doginal Dog #' . $dogNumber : 'Doginal Dog'),
            'inscriptionId' => isset($listing['inscriptionId']) ? $listing['inscriptionId'] : null,
            'priceDoge' => normalizeNumber(isset($listing['priceDoge']) ? $listing['priceDoge'] : null),
            'sellerAddress' => isset($listing['sellerAddress']) ? $listing['sellerAddress'] : null,
            'imageUrl' => buildDogImageUrl($dogNumber),
            'createdAt' => isset($listing['createdAt']) ? $listing['createdAt'] : null,
            'expiresAt' => isset($listing['expiresAt']) ? $listing['expiresAt'] : null,
        );
    }

    $cache[$limit] = $offers;
    return $cache[$limit];
}

function getActiveListingCount($limit = 100, $maxPages = 100) {
    global $MARKET_PULSE_CACHE_CANDIDATE_PATHS;

    static $cache = array();
    $limit = max(1, min(100, intval($limit)));
    $maxPages = max(1, min(250, intval($maxPages)));
    $cacheKey = $limit . ':' . $maxPages;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $cachePath = getWritableCachePath($MARKET_PULSE_CACHE_CANDIDATE_PATHS);
    $cacheTtl = 300;
    $cachedPayload = readJsonCacheFile($cachePath);
    $cachedGeneratedAt = is_array($cachedPayload) && isset($cachedPayload['generatedAt']) ? strtotime($cachedPayload['generatedAt']) : false;
    $cachedCount = is_array($cachedPayload) && isset($cachedPayload['totalListings'])
        ? intval($cachedPayload['totalListings'])
        : null;

    if ($cachedCount !== null && $cachedGeneratedAt !== false && (time() - $cachedGeneratedAt) < $cacheTtl) {
        $cache[$cacheKey] = $cachedCount;
        return $cache[$cacheKey];
    }

    $count = 0;
    $cursor = null;
    $page = 0;
    while ($page < $maxPages) {
        $input = array(
            'limit' => $limit,
            'sortBy' => 'price',
            'sortOrder' => 'asc',
        );
        if ($cursor !== null) {
            $input['cursor'] = $cursor;
        }

        $data = trpcData('listings.getAll', $input, 'listings');
        $listings = isset($data['listings']) && is_array($data['listings']) ? $data['listings'] : array();
        $count += count($listings);
        $page += 1;

        if (!isset($data['nextCursor']) || !$data['nextCursor'] || count($listings) === 0) {
            break;
        }

        $cursor = $data['nextCursor'];
    }

    $cacheData = is_array($cachedPayload) ? $cachedPayload : array();
    $cacheData['generatedAt'] = gmdate('c');
    $cacheData['totalListings'] = $count;
    writeJsonCacheFile($cachePath, $cacheData);

    $cache[$cacheKey] = $count;
    return $cache[$cacheKey];
}

function getRecentSaleActivity($limit = 6) {
    static $cache = array();
    $limit = max(1, min(12, intval($limit)));

    if (array_key_exists($limit, $cache)) {
        return $cache[$limit];
    }

    $data = trpcData('activity.getGlobal', array('limit' => max(100, $limit * 10)), 'activity');
    $activities = isset($data['activities']) && is_array($data['activities']) ? $data['activities'] : array();
    $sales = array();

    foreach ($activities as $activity) {
        if (!isset($activity['activityType']) || $activity['activityType'] !== 'sale') {
            continue;
        }

        $saleState = normalizeSaleActivityState($activity);

        $dogNumber = null;
        if (isset($activity['dogName']) && preg_match('/#(\d+)/', $activity['dogName'], $matches)) {
            $dogNumber = intval($matches[1]);
        }

        $sales[] = array(
            'dogNumber' => $dogNumber,
            'name' => isset($activity['dogName']) ? $activity['dogName'] : ($dogNumber !== null ? 'Doginal Dog #' . $dogNumber : 'Doginal Dog'),
            'priceDoge' => normalizeNumber(isset($activity['priceDoge']) ? $activity['priceDoge'] : null),
            'status' => $saleState['status'],
            'date' => $saleState['date'],
            'confirmedAt' => $saleState['confirmedAt'],
            'isConfirmed' => $saleState['isConfirmed'],
            'txid' => isset($activity['txid']) ? $activity['txid'] : null,
            'imageUrl' => buildDogImageUrl($dogNumber),
        );

    }

    $sales = selectTopSales($sales, $limit);

    $cache[$limit] = $sales;
    return $cache[$limit];
}

function getAllGlobalActivity($limit = 100, $maxPages = 100) {
    static $cache = array();
    $limit = max(1, min(100, intval($limit)));
    $maxPages = max(1, min(250, intval($maxPages)));
    $cacheKey = $limit . ':' . $maxPages;

    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $all = array();
    $cursor = null;
    $page = 0;
    while ($page < $maxPages) {
        $input = array('limit' => $limit);
        if ($cursor !== null) {
            $input['cursor'] = $cursor;
        }

        $data = trpcData('activity.getGlobal', $input, 'activity');
        $activities = isset($data['activities']) && is_array($data['activities']) ? $data['activities'] : array();
        $all = array_merge($all, $activities);
        $page += 1;

        if (!isset($data['nextCursor']) || !$data['nextCursor'] || count($activities) === 0) {
            break;
        }

        $cursor = $data['nextCursor'];
    }

    $cache[$cacheKey] = $all;
    return $cache[$cacheKey];
}

function getAllTimeTopSales($limit = 5) {
    global $MARKET_PULSE_CACHE_CANDIDATE_PATHS;

    static $cache = array();
    $limit = max(1, min(12, intval($limit)));

    if (array_key_exists($limit, $cache)) {
        return $cache[$limit];
    }

    $cachePath = getWritableCachePath($MARKET_PULSE_CACHE_CANDIDATE_PATHS);
    $cacheTtl = 900;
    $cachedPayload = readJsonCacheFile($cachePath);
    $cachedGeneratedAt = is_array($cachedPayload) && isset($cachedPayload['generatedAt']) ? strtotime($cachedPayload['generatedAt']) : false;
    $cachedSales = is_array($cachedPayload) && isset($cachedPayload['topSales']) && is_array($cachedPayload['topSales'])
        ? $cachedPayload['topSales']
        : null;

    if ($cachedSales !== null && $cachedGeneratedAt !== false && (time() - $cachedGeneratedAt) < $cacheTtl && count($cachedSales) >= $limit) {
        $cache[$limit] = array_slice($cachedSales, 0, $limit);
        return $cache[$limit];
    }

    $activities = getAllGlobalActivity(100, 100);
    $sales = array();
    foreach ($activities as $activity) {
        if (!isset($activity['activityType']) || $activity['activityType'] !== 'sale') {
            continue;
        }

        $saleState = normalizeSaleActivityState($activity);
        $dogNumber = null;
        if (isset($activity['dogName']) && preg_match('/#(\d+)/', $activity['dogName'], $matches)) {
            $dogNumber = intval($matches[1]);
        }

        $sales[] = array(
            'dogNumber' => $dogNumber,
            'name' => isset($activity['dogName']) ? $activity['dogName'] : ($dogNumber !== null ? 'Doginal Dog #' . $dogNumber : 'Doginal Dog'),
            'priceDoge' => normalizeNumber(isset($activity['priceDoge']) ? $activity['priceDoge'] : null),
            'status' => $saleState['status'],
            'date' => $saleState['date'],
            'confirmedAt' => $saleState['confirmedAt'],
            'isConfirmed' => $saleState['isConfirmed'],
            'txid' => isset($activity['txid']) ? $activity['txid'] : null,
            'imageUrl' => buildDogImageUrl($dogNumber),
        );
    }

    $topSales = selectTopSales($sales, 12);
    $cacheData = is_array($cachedPayload) ? $cachedPayload : array();
    $cacheData['generatedAt'] = gmdate('c');
    $cacheData['topSales'] = $topSales;
    writeJsonCacheFile($cachePath, $cacheData);

    $cache[$limit] = array_slice($topSales, 0, $limit);
    return $cache[$limit];
}

function getMarketPulsePayload($offersLimit = 6, $salesLimit = 6) {
    $dogeUsd = getDogecoinPrice();
    $offers = getActiveListings($offersLimit);
    $totalListings = getActiveListingCount();
    $sales = getAllTimeTopSales($salesLimit);
    $floorListing = count($offers) > 0 ? $offers[0] : getFloorListing();
    $floorDoge = is_array($floorListing) && isset($floorListing['priceDoge'])
        ? normalizeNumber($floorListing['priceDoge'])
        : null;

    foreach ($offers as &$offer) {
        $offer['priceUsd'] = toUsdValue(isset($offer['priceDoge']) ? $offer['priceDoge'] : null, $dogeUsd);
    }
    unset($offer);

    foreach ($sales as &$sale) {
        $sale['priceUsd'] = toUsdValue(isset($sale['priceDoge']) ? $sale['priceDoge'] : null, $dogeUsd);
    }
    unset($sale);

    return array(
        'generatedAt' => gmdate('c'),
        'dogeUsd' => $dogeUsd,
        'freshness' => array(
            'offersSource' => 'live',
            'salesSource' => 'all-time',
            'priceSource' => 'live',
        ),
        'snapshot' => array(
            'ready' => true,
            'builtAt' => gmdate('c'),
            'totalListings' => $totalListings,
            'floorDoge' => $floorDoge,
            'floorUsd' => toUsdValue($floorDoge, $dogeUsd),
            'medianDoge' => null,
            'medianUsd' => null,
            'refreshIntervalHours' => null,
        ),
        'currentOffers' => $offers,
        'topSales' => $sales,
    );
}

function buildSaleTraitMap($sales) {
    global $TRAIT_KEYS;
    static $cache = array();
    $cacheKey = md5(json_encode($sales));
    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $saleTraitPrices = array();
    $saleTraitsByDog = array(); // dogNumber => traits for sold dogs

    foreach ($sales as $sale) {
        try {
            $traits = getDogTraitsRecord($sale['dogNumber']);
        } catch (Exception $e) {
            continue;
        }
        if (!$traits) continue;
        $saleTraitsByDog[$sale['dogNumber']] = $traits;
        foreach ($TRAIT_KEYS as $key) {
            $val = isset($traits[$key]) ? $traits[$key] : null;
            if ($val === null || $val === '') continue;
            if (!isset($saleTraitPrices[$key])) $saleTraitPrices[$key] = array();
            if (!isset($saleTraitPrices[$key][$val])) $saleTraitPrices[$key][$val] = array();
            $saleTraitPrices[$key][$val][] = $sale['priceDoge'];
        }
    }
    // Compute stats per trait value including max (topSale)
    $saleTraitStats = array();
    foreach ($saleTraitPrices as $key => $values) {
        $saleTraitStats[$key] = array();
        foreach ($values as $val => $prices) {
            sort($prices);
            $count = count($prices);
            $mid = intval(floor($count / 2));
            $median = $count % 2 === 1 ? $prices[$mid] : ($prices[$mid - 1] + $prices[$mid]) / 2;
            $saleTraitStats[$key][$val] = array(
                'floor' => $prices[0],
                'median' => $median,
                'topSale' => max($prices),
                'count' => $count,
            );
        }
    }
    $cache[$cacheKey] = $saleTraitStats;
    return $cache[$cacheKey];
}

function getTraitMarketSnapshot($forceReload = false) {
    global $TRAIT_KEYS;

    static $loaded = false;
    static $snapshot = null;

    if ($forceReload) {
        $loaded = false;
        $snapshot = null;
    }

    if ($loaded) {
        return $snapshot;
    }

    $dogeUsd = null;
    try {
        $dogeUsd = getDogecoinPrice();
    } catch (Exception $e) {
        $dogeUsd = null;
    }

    $traitCounts = array();
    try {
        $traitCounts = getTraitCounts();
    } catch (Exception $e) {
        $traitCounts = array();
    }

    $data = trpcData('listings.getAll', array(
        'sortBy' => 'price',
        'sortOrder' => 'asc',
    ), 'listings');
    $rawListings = isset($data['listings']) && is_array($data['listings']) ? $data['listings'] : array();

    $traitPrices = array();
    $allPrices = array();
    foreach ($rawListings as $listing) {
        $dogNumber = null;
        if (isset($listing['dogId']) && is_numeric($listing['dogId'])) {
            $dogNumber = intval($listing['dogId']);
        } elseif (isset($listing['dogName']) && preg_match('/#(\d+)/', $listing['dogName'], $matches)) {
            $dogNumber = intval($matches[1]);
        }

        $price = normalizeNumber(isset($listing['priceDoge']) ? $listing['priceDoge'] : null);
        if ($price === null || $price <= 0) {
            continue;
        }

        $allPrices[] = $price;
        if ($dogNumber === null) {
            continue;
        }

        $traits = getDogTraitsRecord($dogNumber);
        if (!is_array($traits)) {
            continue;
        }

        foreach ($TRAIT_KEYS as $key) {
            $value = isset($traits[$key]) ? $traits[$key] : null;
            if ($value === null || $value === '') {
                continue;
            }

            if (!isset($traitPrices[$key])) {
                $traitPrices[$key] = array();
            }
            if (!isset($traitPrices[$key][$value])) {
                $traitPrices[$key][$value] = array();
            }
            $traitPrices[$key][$value][] = $price;
        }
    }

    $traitStats = array();
    foreach ($traitPrices as $key => $values) {
        $traitStats[$key] = array();
        foreach ($values as $value => $prices) {
            sort($prices);
            $traitStats[$key][$value] = array(
                'floor' => $prices[0],
                'median' => medianValue($prices),
                'mean' => round(meanValue($prices), 2),
                'listed' => count($prices),
            );
        }
    }

    sort($allPrices);

    $recentSales = array();
    $saleTraitStats = array();
    try {
        $recentSales = getRecentSales(100);
        if (count($recentSales) > 0) {
            $saleTraitStats = buildSaleTraitMap($recentSales);
        }
    } catch (Exception $e) {
        $recentSales = array();
        $saleTraitStats = array();
    }

    $snapshot = array(
        'builtAt' => gmdate('c'),
        'dogeUsd' => $dogeUsd,
        'collectionStats' => array(
            'floor' => count($allPrices) > 0 ? $allPrices[0] : null,
            'totalListed' => count($rawListings),
            'dogeUsd' => $dogeUsd,
        ),
        'traitStats' => $traitStats,
        'saleTraitStats' => $saleTraitStats,
        'traitMeta' => array(
            'counts' => $traitCounts,
        ),
        'recentSales' => $recentSales,
    );

    $loaded = true;
    return $snapshot;
}

function getTraitCounts() {
    static $loaded = false;
    static $counts = array();

    if ($loaded) {
        return $counts;
    }

    $catalogCounts = getCatalogTraitCounts();
    if (count($catalogCounts) > 0) {
        $counts = $catalogCounts;
        $loaded = true;
        return $counts;
    }

    $data = trpcData('wallet.getTraitValues', null, 'trait values');
    $counts = isset($data['counts']) && is_array($data['counts']) ? $data['counts'] : array();
    $loaded = true;
    return $counts;
}

function getWalletData($address) {
    static $cache = array();
    if (array_key_exists($address, $cache)) {
        return $cache[$address];
    }

    $data = trpcData('wallet.getAllWalletData', array('address' => $address), 'wallet data');
    $cache[$address] = is_array($data) ? $data : array();
    return $cache[$address];
}

function getWalletSearchProfile($address) {
    static $cache = array();
    if (array_key_exists($address, $cache)) {
        return $cache[$address];
    }

    $data = trpcData('search.search', array('query' => $address, 'limit' => 5), 'wallet search');
    $results = isset($data['results']) && is_array($data['results']) ? $data['results'] : array();

    foreach ($results as $item) {
        if (isset($item['address']) && strval($item['address']) === $address) {
            $cache[$address] = $item;
            return $cache[$address];
        }
    }

    $cache[$address] = null;
    return $cache[$address];
}

function getOwnersLeaderboardEntries($twitterOnly = false) {
    static $cache = array();
    $cacheKey = $twitterOnly ? '1' : '0';
    if (array_key_exists($cacheKey, $cache)) {
        return $cache[$cacheKey];
    }

    $data = trpcData('owners.getLeaderboard', array('twitterOnly' => !!$twitterOnly), 'owners leaderboard');
    $cache[$cacheKey] = isset($data['entries']) && is_array($data['entries']) ? $data['entries'] : array();
    return $cache[$cacheKey];
}

function getLeaderboardTier($rank, $hasTwitter) {
    $tiers = array(
        'diamond' => array(
            'name' => 'diamond',
            'label' => 'Orange',
            'color' => '#fb923c',
            'colorLight' => '#fdba74',
            'colorDark' => '#ea580c',
            'glowColor' => 'rgba(251, 146, 60, 0.5)',
            'animated' => true,
        ),
        'gold' => array(
            'name' => 'gold',
            'label' => 'Purple',
            'color' => '#c084fc',
            'colorLight' => '#d8b4fe',
            'colorDark' => '#a855f7',
            'glowColor' => 'rgba(192, 132, 252, 0.35)',
            'animated' => false,
        ),
        'silver' => array(
            'name' => 'silver',
            'label' => 'Blue',
            'color' => '#60a5fa',
            'colorLight' => '#93c5fd',
            'colorDark' => '#3b82f6',
            'glowColor' => 'rgba(96, 165, 250, 0.3)',
            'animated' => false,
        ),
        'grey' => array(
            'name' => 'grey',
            'label' => 'Grey',
            'color' => 'rgba(255, 255, 255, 0.4)',
            'colorLight' => 'rgba(255, 255, 255, 0.5)',
            'colorDark' => 'rgba(255, 255, 255, 0.2)',
            'glowColor' => 'transparent',
            'animated' => false,
        ),
    );

    if (!$hasTwitter || $rank === null) {
        return $tiers['grey'];
    }
    if ($rank <= 5) {
        return $tiers['diamond'];
    }
    if ($rank <= 15) {
        return $tiers['gold'];
    }
    if ($rank <= 35) {
        return $tiers['silver'];
    }
    return $tiers['grey'];
}

function getWalletProfileSummary($address, $dogNumbers = array()) {
    global $MARKET_BASE;

    $profile = array(
        'displayName' => null,
        'username' => null,
        'verified' => false,
        'rank' => null,
        'nonListedCount' => null,
        'inscriptionCount' => null,
        'selectedDogNumber' => count($dogNumbers) > 0 ? intval($dogNumbers[0]) : null,
        'imageUrl' => null,
        'marketUrl' => $MARKET_BASE . '/wallet/' . rawurlencode($address),
    );

    try {
        $searchProfile = getWalletSearchProfile($address);
        if (is_array($searchProfile)) {
            $profile['displayName'] = isset($searchProfile['twitterDisplayName']) ? $searchProfile['twitterDisplayName'] : $profile['displayName'];
            $profile['username'] = isset($searchProfile['twitterUsername']) ? $searchProfile['twitterUsername'] : $profile['username'];
            $profile['verified'] = !empty($searchProfile['twitterVerified']);
        }
    } catch (Exception $e) {
        // Keep the wallet lookup responsive even if the profile overlay fails.
    }

    try {
        $entries = getOwnersLeaderboardEntries(false);
        foreach ($entries as $entry) {
            if (!isset($entry['ownerAddress']) || strval($entry['ownerAddress']) !== $address) {
                continue;
            }

            $profile['rank'] = isset($entry['rank']) && $entry['rank'] !== null ? intval($entry['rank']) : null;
            $profile['nonListedCount'] = isset($entry['nonListedCount']) ? intval($entry['nonListedCount']) : null;
            $profile['inscriptionCount'] = isset($entry['inscriptionCount']) ? intval($entry['inscriptionCount']) : null;
            $profile['selectedDogNumber'] = isset($entry['selectedDogNumber']) && $entry['selectedDogNumber'] !== null
                ? intval($entry['selectedDogNumber'])
                : $profile['selectedDogNumber'];

            if (isset($entry['twitter']) && is_array($entry['twitter'])) {
                $profile['displayName'] = isset($entry['twitter']['displayName']) ? $entry['twitter']['displayName'] : $profile['displayName'];
                $profile['username'] = isset($entry['twitter']['username']) ? $entry['twitter']['username'] : $profile['username'];
                $profile['verified'] = !empty($entry['twitter']['verified']);
            }
            break;
        }
    } catch (Exception $e) {
        // Ranking info is supplemental; return the wallet anyway.
    }

    $profile['tier'] = getLeaderboardTier($profile['rank'], !empty($profile['displayName']) || !empty($profile['username']));
    $profile['imageUrl'] = $profile['selectedDogNumber'] !== null
        ? $MARKET_BASE . '/dogs/' . intval($profile['selectedDogNumber']) . '.png'
        : null;

    if (!$profile['displayName']) {
        $profile['displayName'] = substr($address, 0, 6) . '...' . substr($address, -4);
    }

    return $profile;
}

function getDogDisplayOverride($dogNumber) {
    $overrides = array(
        9168 => array(
            'traits' => array(
                'mouth' => array(
                    'displayValue' => 'Tongue In Mouth',
                    'displayTraitCount' => 1,
                    'displayBadge' => '1/1'
                )
            )
        ),
        6164 => array(
            'traits' => array(
                'head' => array(
                    'displayValue' => 'Wizard Head',
                    'displayTraitCount' => 1,
                    'displayBadge' => '1/1'
                )
            )
        ),
    );

    return isset($overrides[$dogNumber]) ? $overrides[$dogNumber] : null;
}

function applyTraitDisplayOverrides(&$traitBreakdown, $displayOverride) {
    if (!$displayOverride || !isset($displayOverride['traits']) || !is_array($displayOverride['traits'])) {
        return;
    }

    foreach ($displayOverride['traits'] as $traitKey => $traitOverride) {
        $found = false;
        foreach ($traitBreakdown as &$entry) {
            if ($entry['trait'] !== $traitKey) {
                continue;
            }

            $entry['displayValue'] = isset($traitOverride['displayValue']) ? $traitOverride['displayValue'] : $entry['value'];
            $entry['displayTraitCount'] = isset($traitOverride['displayTraitCount']) ? $traitOverride['displayTraitCount'] : $entry['traitCount'];
            $entry['displayBadge'] = isset($traitOverride['displayBadge']) ? $traitOverride['displayBadge'] : null;
            $found = true;
            break;
        }
        unset($entry);

        if ($found) {
            continue;
        }

        $traitBreakdown[] = array(
            'trait' => $traitKey,
            'value' => isset($traitOverride['value']) ? $traitOverride['value'] : null,
            'floor' => null,
            'median' => null,
            'mean' => null,
            'listed' => 0,
            'saleFloor' => null,
            'saleMedian' => null,
            'saleCount' => 0,
            'topSale' => null,
            'traitCount' => isset($traitOverride['displayTraitCount']) ? intval($traitOverride['displayTraitCount']) : null,
            'isTopSale' => false,
            'displayValue' => isset($traitOverride['displayValue']) ? $traitOverride['displayValue'] : (isset($traitOverride['value']) ? $traitOverride['value'] : null),
            'displayTraitCount' => isset($traitOverride['displayTraitCount']) ? intval($traitOverride['displayTraitCount']) : null,
            'displayBadge' => isset($traitOverride['displayBadge']) ? $traitOverride['displayBadge'] : null,
            'isSynthetic' => true,
        );
    }
}

function resolveValueMultiplier($traitBreakdown, $displayOverride) {
    if ($displayOverride && isset($displayOverride['estimation']['valueMultiplier'])) {
        return floatval($displayOverride['estimation']['valueMultiplier']);
    }

    foreach ($traitBreakdown as $entry) {
        if ((isset($entry['displayBadge']) && $entry['displayBadge'] === '1/1')
            || (isset($entry['displayTraitCount']) && intval($entry['displayTraitCount']) === 1)
            || (empty($entry['isSynthetic']) && isset($entry['traitCount']) && intval($entry['traitCount']) === 1)) {
            return 3.0;
        }
    }

    return 1.0;
}

// Color keywords for the color-match bonus metric
$DD_COLOR_MATCH_WORDS = array(
    'gold', 'silver', 'black', 'white', 'red', 'blue', 'green', 'yellow',
    'orange', 'purple', 'pink', 'brown', 'gray', 'grey', 'cyan', 'teal',
    'navy', 'cream', 'tan', 'beige', 'olive', 'diamond', 'crimson', 'violet',
);

function extractDominantColor($value) {
    global $DD_COLOR_MATCH_WORDS;
    if (!$value) return null;
    $lower = strtolower($value);
    foreach ($DD_COLOR_MATCH_WORDS as $color) {
        if (strpos($lower, $color) !== false) return $color;
    }
    return null;
}

function summarizeEvaluation($evaluation, $dogeUsd) {
    $estimation = isset($evaluation['estimation']) && is_array($evaluation['estimation']) ? $evaluation['estimation'] : array();
    $listingAnalysis = isset($evaluation['listingAnalysis']) && is_array($evaluation['listingAnalysis']) ? $evaluation['listingAnalysis'] : array();

    $estimatedDoge = isset($estimation['displayEstimatedDoge']) && $estimation['displayEstimatedDoge'] !== null
        ? $estimation['displayEstimatedDoge']
        : (isset($estimation['estimatedDoge']) ? $estimation['estimatedDoge'] : null);
    $estimatedUsd = isset($estimation['displayEstimatedUsd']) && $estimation['displayEstimatedUsd'] !== null
        ? $estimation['displayEstimatedUsd']
        : (isset($estimation['estimatedUsd']) ? $estimation['estimatedUsd'] : (($estimatedDoge !== null && $dogeUsd !== null) ? round($estimatedDoge * $dogeUsd, 2) : null));
    $askingPriceDoge = isset($listingAnalysis['askingPriceDoge']) ? $listingAnalysis['askingPriceDoge'] : null;

    return array(
        'dogNumber' => $evaluation['dogNumber'],
        'name' => isset($evaluation['name']) ? $evaluation['name'] : ('Doginal Dog #' . $evaluation['dogNumber']),
        'inscriptionId' => isset($evaluation['inscriptionId']) ? $evaluation['inscriptionId'] : null,
        'imageUrl' => isset($evaluation['imageUrl']) ? $evaluation['imageUrl'] : null,
        'isListed' => !empty($evaluation['isListed']),
        'rarityRank' => isset($evaluation['rarityRank']) ? $evaluation['rarityRank'] : null,
        'rarityLabel' => isset($evaluation['rarityLabel']) ? $evaluation['rarityLabel'] : null,
        'estimatedDoge' => $estimatedDoge,
        'estimatedUsd' => $estimatedUsd,
        'askingPriceDoge' => $askingPriceDoge,
        'askingPriceUsd' => ($askingPriceDoge !== null && $dogeUsd !== null) ? round($askingPriceDoge * $dogeUsd, 2) : null,
        'valueMultiplier' => isset($estimation['valueMultiplier']) ? $estimation['valueMultiplier'] : null,
        'rarestTrait' => isset($estimation['rarestTrait']) ? $estimation['rarestTrait'] : null,
        'compoundAnchor' => isset($estimation['compoundAnchor']) ? $estimation['compoundAnchor'] : null,
        'displayEstimatedUsdNote' => isset($estimation['displayEstimatedUsdNote']) ? $estimation['displayEstimatedUsdNote'] : null,
    );
}

function normalizeEvaluationLogEntry($entry) {
    if (!is_array($entry)) {
        return null;
    }

    $dogNumber = normalizeImportDogNumber(isset($entry['dogNumber']) ? $entry['dogNumber'] : null);
    if ($dogNumber === null) {
        return null;
    }

    $evaluatedAt = normalizeImportTimestamp(isset($entry['evaluatedAt']) ? $entry['evaluatedAt'] : null, gmdate('c'));
    $estimatedDoge = isset($entry['estimatedDoge']) && is_numeric($entry['estimatedDoge']) ? floatval($entry['estimatedDoge']) : null;
    $estimatedUsd = isset($entry['estimatedUsd']) && is_numeric($entry['estimatedUsd']) ? floatval($entry['estimatedUsd']) : null;
    $rarityRank = isset($entry['rarityRank']) && is_numeric($entry['rarityRank']) ? intval($entry['rarityRank']) : null;
    $source = trim(strval(isset($entry['source']) ? $entry['source'] : 'php'));

    return array(
        'evaluatedAt' => $evaluatedAt,
        'dogNumber' => $dogNumber,
        'name' => isset($entry['name']) ? $entry['name'] : ('Doginal Dog #' . $dogNumber),
        'inscriptionId' => isset($entry['inscriptionId']) ? $entry['inscriptionId'] : null,
        'imageUrl' => isset($entry['imageUrl']) && $entry['imageUrl'] ? $entry['imageUrl'] : buildDogImageUrl($dogNumber),
        'estimatedDoge' => $estimatedDoge,
        'estimatedUsd' => $estimatedUsd,
        'rarityRank' => $rarityRank,
        'rarityLabel' => isset($entry['rarityLabel']) ? $entry['rarityLabel'] : null,
        'isListed' => !empty($entry['isListed']),
        'source' => $source !== '' ? $source : 'php',
    );
}

function buildEvaluationLogEntry($evaluation, $source, $overrides = array()) {
    if (!is_array($evaluation) || !isset($evaluation['dogNumber'])) {
        return null;
    }

    $estimation = isset($evaluation['estimation']) && is_array($evaluation['estimation']) ? $evaluation['estimation'] : array();
    $estimatedDoge = isset($estimation['displayEstimatedDoge']) && $estimation['displayEstimatedDoge'] !== null
        ? $estimation['displayEstimatedDoge']
        : (isset($estimation['estimatedDoge']) ? $estimation['estimatedDoge'] : null);
    $estimatedUsd = isset($estimation['displayEstimatedUsd']) && $estimation['displayEstimatedUsd'] !== null
        ? $estimation['displayEstimatedUsd']
        : (isset($estimation['estimatedUsd']) ? $estimation['estimatedUsd'] : null);

    return normalizeEvaluationLogEntry(array_merge(array(
        'evaluatedAt' => isset($evaluation['evaluatedAt']) ? $evaluation['evaluatedAt'] : gmdate('c'),
        'dogNumber' => intval($evaluation['dogNumber']),
        'name' => isset($evaluation['name']) ? $evaluation['name'] : ('Doginal Dog #' . intval($evaluation['dogNumber'])),
        'inscriptionId' => isset($evaluation['inscriptionId']) ? $evaluation['inscriptionId'] : null,
        'imageUrl' => isset($evaluation['imageUrl']) ? $evaluation['imageUrl'] : buildDogImageUrl(intval($evaluation['dogNumber'])),
        'estimatedDoge' => $estimatedDoge !== null ? floatval($estimatedDoge) : null,
        'estimatedUsd' => $estimatedUsd !== null ? floatval($estimatedUsd) : null,
        'rarityRank' => isset($evaluation['rarityRank']) ? intval($evaluation['rarityRank']) : null,
        'rarityLabel' => isset($evaluation['rarityLabel']) ? $evaluation['rarityLabel'] : null,
        'isListed' => !empty($evaluation['isListed']),
        'source' => $source,
    ), is_array($overrides) ? $overrides : array()));
}

function appendEvaluationLogEntry($evaluation, $source = 'php', $overrides = array()) {
    global $EVALUATION_LOG_CANDIDATE_PATHS;

    $entry = buildEvaluationLogEntry($evaluation, $source, $overrides);
    if ($entry === null || count($EVALUATION_LOG_CANDIDATE_PATHS) === 0) {
        return;
    }

    $path = $EVALUATION_LOG_CANDIDATE_PATHS[0];
    $dir = dirname($path);
    if (!is_dir($dir)) {
        @mkdir($dir, 0777, true);
    }

    @file_put_contents($path, json_encode($entry, JSON_UNESCAPED_SLASHES) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function getEvaluationLog($options = 100) {
    global $EVALUATION_LOG_CANDIDATE_PATHS;

    $settings = is_array($options) ? $options : array('limit' => $options);
    $normalizedLimit = isset($settings['limit']) && $settings['limit'] !== null
        ? max(1, min(5000, intval($settings['limit'])))
        : null;
    $sinceTimestamp = isset($settings['since']) ? strtotime($settings['since']) : false;
    $reverse = !isset($settings['reverse']) || !!$settings['reverse'];

    foreach ($EVALUATION_LOG_CANDIDATE_PATHS as $filePath) {
        if (!$filePath || !is_file($filePath)) {
            continue;
        }

        $lines = @file($filePath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if (!is_array($lines)) {
            continue;
        }

        $entries = array();
        foreach ($lines as $line) {
            $decoded = json_decode($line, true);
            $normalized = normalizeEvaluationLogEntry($decoded);
            if ($normalized === null) {
                continue;
            }

            if ($sinceTimestamp !== false) {
                $entryTimestamp = strtotime($normalized['evaluatedAt']);
                if ($entryTimestamp !== false && $entryTimestamp < $sinceTimestamp) {
                    continue;
                }
            }

            $entries[] = $normalized;
        }

        if ($normalizedLimit !== null) {
            $entries = array_slice($entries, -$normalizedLimit);
        }

        return $reverse ? array_reverse($entries) : $entries;
    }

    return array();
}

function clearEvaluationLogEntries($options = array()) {
    global $EVALUATION_LOG_CANDIDATE_PATHS;

    $settings = is_array($options) ? $options : array();
    $source = isset($settings['source']) ? trim(strval($settings['source'])) : '';
    if ($source === '') {
        $source = null;
    }

    if (count($EVALUATION_LOG_CANDIDATE_PATHS) === 0) {
        return array('removedCount' => 0, 'remainingCount' => 0, 'source' => $source);
    }

    $path = $EVALUATION_LOG_CANDIDATE_PATHS[0];
    if (!$path || !is_file($path)) {
        return array('removedCount' => 0, 'remainingCount' => 0, 'source' => $source);
    }

    $lines = @file($path, FILE_IGNORE_NEW_LINES);
    if ($lines === false) {
        throw new Exception('Failed to read DD evaluation log.');
    }

    $keptLines = array();
    $removedCount = 0;

    foreach ($lines as $line) {
        if (trim($line) === '') {
            continue;
        }

        $decoded = json_decode($line, true);
        $normalized = normalizeEvaluationLogEntry($decoded);
        if ($normalized !== null && ($source === null || $normalized['source'] === $source)) {
            $removedCount += 1;
            continue;
        }

        $keptLines[] = $line;
    }

    if ($removedCount > 0) {
        $output = count($keptLines) > 0 ? implode(PHP_EOL, $keptLines) . PHP_EOL : '';
        if (@file_put_contents($path, $output, LOCK_EX) === false) {
            throw new Exception('Failed to rewrite DD evaluation log.');
        }
    }

    return array(
        'removedCount' => $removedCount,
        'remainingCount' => count($keptLines),
        'source' => $source,
    );
}

function getTrendingDashboardData() {
    global $TRAIT_KEYS, $DD_IMPORT_LOOKBACK_HOURS;

    $snapshot = getTraitMarketSnapshot();
    $config = getTrendingConfigData(true);
    $summary = buildTrendingSummary(
        isset($snapshot['traitStats']) ? $snapshot['traitStats'] : array(),
        isset($snapshot['saleTraitStats']) ? $snapshot['saleTraitStats'] : array(),
        isset($snapshot['traitMeta']) ? $snapshot['traitMeta'] : array()
    );
    $suppressedTrendKeys = array_flip(isset($config['autoTrend']['disabledTrendKeys']) && is_array($config['autoTrend']['disabledTrendKeys']) ? $config['autoTrend']['disabledTrendKeys'] : array());

    $liveDogeUsd = isset($snapshot['dogeUsd']) ? $snapshot['dogeUsd'] : null;
    if ($liveDogeUsd === null) {
        try {
            $liveDogeUsd = getDogecoinPrice();
        } catch (Exception $e) {
            $liveDogeUsd = null;
        }
    }

    $classifyTraitRarityBand = function ($traitCount) {
        if ($traitCount === null) {
            return 'unknown';
        }
        if ($traitCount <= 100) {
            return 'ultra-rare';
        }
        if ($traitCount <= 250) {
            return 'very rare';
        }
        if ($traitCount <= 500) {
            return 'rare';
        }
        if ($traitCount <= 800) {
            return 'notable';
        }
        if ($traitCount <= 1500) {
            return 'scarce';
        }
        return 'common';
    };

    $formatTrendReason = function ($entry) {
        if (!is_array($entry)) {
            return 'No trend applied.';
        }

        $source = isset($entry['source']) ? strval($entry['source']) : 'none';
        $manualMultiplier = isset($entry['manualMultiplier']) ? normalizeNumber($entry['manualMultiplier']) : null;
        $autoMultiplier = isset($entry['autoMultiplier']) ? normalizeNumber($entry['autoMultiplier']) : null;
        $autoMetrics = isset($entry['autoMetrics']) && is_array($entry['autoMetrics']) ? $entry['autoMetrics'] : array();

        if ($source === 'manual') {
            if ($manualMultiplier !== null && $autoMultiplier !== null) {
                return 'Manual override ' . number_format($manualMultiplier, 2, '.', '') . 'x over auto ' . number_format($autoMultiplier, 2, '.', '') . 'x.';
            }
            if ($manualMultiplier !== null) {
                return 'Manual override ' . number_format($manualMultiplier, 2, '.', '') . 'x.';
            }
        }

        if ($source === 'auto' && $autoMultiplier !== null) {
            $notes = array();
            if (isset($autoMetrics['salesPercent']) && $autoMetrics['salesPercent'] !== null) {
                $notes[] = number_format(floatval($autoMetrics['salesPercent']) * 100, 2, '.', '') . '% sold';
            }
            if (isset($autoMetrics['listedPercent']) && $autoMetrics['listedPercent'] !== null) {
                $notes[] = number_format(floatval($autoMetrics['listedPercent']) * 100, 2, '.', '') . '% listed';
            }
            return 'Auto trend ' . number_format($autoMultiplier, 2, '.', '') . 'x from ' . (count($notes) > 0 ? implode(' · ', $notes) : 'recent market activity') . '.';
        }

        if (!empty($entry['autoSuppressed'])) {
            if ($autoMultiplier !== null) {
                return 'Auto signal ' . number_format($autoMultiplier, 2, '.', '') . 'x is suppressed in pricing.';
            }
            return 'Auto signal is suppressed in pricing.';
        }

        return 'No trend applied.';
    };

    $describeBasePriceSignal = function ($entry) {
        $evidence = array();
        foreach (array(
            'top sale' => isset($entry['topSaleDoge']) ? $entry['topSaleDoge'] : null,
            'sale median' => isset($entry['saleMedianDoge']) ? $entry['saleMedianDoge'] : null,
            'sale floor' => isset($entry['saleFloorDoge']) ? $entry['saleFloorDoge'] : null,
            'listing floor' => isset($entry['floorDoge']) ? $entry['floorDoge'] : null,
        ) as $source => $value) {
            $number = normalizeNumber($value);
            if ($number !== null && $number > 0) {
                $evidence[] = array('source' => $source, 'value' => $number);
            }
        }

        $strongest = null;
        foreach ($evidence as $signal) {
            if ($strongest === null || $signal['value'] > $strongest['value']) {
                $strongest = $signal;
            }
        }

        $listed = isset($entry['listed']) ? intval($entry['listed']) : 0;
        $saleCount = isset($entry['saleCount']) ? intval($entry['saleCount']) : 0;
        $marketEvidenceCount = ($listed > 0 ? 1 : 0) + ($saleCount > 0 ? 1 : 0);
        $traitCount = isset($entry['traitCount']) ? intval($entry['traitCount']) : null;
        $baseProfile = 'unpriced';
        $baseReason = 'No strong listing or sales signal yet.';

        if ($strongest !== null) {
            $baseProfile = $strongest['source'] === 'listing floor' ? 'listing-backed' : 'sale-backed';
            $baseReason = $strongest['source'] === 'listing floor'
                ? 'Current listing floor is the strongest direct price anchor for this trait.'
                : 'Sales history is the strongest direct price anchor for this trait.';
        }

        if ($traitCount !== null && $traitCount <= 250 && $marketEvidenceCount <= 1) {
            $baseProfile = 'rarity-led';
            $baseReason = $strongest !== null
                ? 'Direct ' . $strongest['source'] . ' data is thin; the price looks mostly driven by scarcity and stacked rarity.'
                : 'There is little direct market evidence, so the value looks driven mostly by scarcity and stacked rarity.';
        }

        return array(
            'baseProfile' => $baseProfile,
            'baseReason' => $baseReason,
            'baseSignalSource' => $strongest !== null ? $strongest['source'] : null,
            'baseSignalDoge' => $strongest !== null ? $strongest['value'] : null,
            'marketEvidenceCount' => $marketEvidenceCount,
        );
    };

    $recentEvaluations = array_values(array_filter(getEvaluationLog(array(
        'since' => gmdate('c', time() - ($DD_IMPORT_LOOKBACK_HOURS * 3600)),
    )), function ($entry) {
        return isset($entry['source']) && $entry['source'] === 'kushmedia-backfill';
    }));

    $communityOffers = array();
    $refusedOffers = isset($config['refusedOffers']) && is_array($config['refusedOffers']) ? $config['refusedOffers'] : array();
    foreach ($refusedOffers as $entry) {
        if (!is_array($entry) || !isset($entry['dogNumber'])) {
            continue;
        }

        $dogNumber = intval($entry['dogNumber']);
        $minOfferUsd = isset($entry['minOfferUsd']) && $entry['minOfferUsd'] !== null
            ? round(floatval($entry['minOfferUsd']), 2)
            : ((isset($entry['minOfferDoge']) && $entry['minOfferDoge'] !== null && $liveDogeUsd !== null)
                ? round(floatval($entry['minOfferDoge']) * $liveDogeUsd, 2)
                : null);
        $minOfferDoge = isset($entry['minOfferDoge']) && $entry['minOfferDoge'] !== null
            ? intval($entry['minOfferDoge'])
            : (($minOfferUsd !== null && $liveDogeUsd !== null && $liveDogeUsd > 0)
                ? intval(round($minOfferUsd / $liveDogeUsd))
                : null);

        $communityOffers[] = array(
            'dogNumber' => $dogNumber,
            'name' => 'Doginal Dog #' . $dogNumber,
            'imageUrl' => buildDogImageUrl($dogNumber),
            'minOfferUsd' => $minOfferUsd,
            'minOfferDoge' => $minOfferDoge,
            'note' => isset($entry['note']) ? $entry['note'] : null,
            'updatedAt' => isset($entry['updatedAt']) ? $entry['updatedAt'] : null,
            'updatedBy' => isset($entry['updatedBy']) ? $entry['updatedBy'] : null,
        );
    }

    usort($communityOffers, function ($left, $right) {
        return intval($left['dogNumber']) - intval($right['dogNumber']);
    });

    $rawTopSaleMap = array();
    $recentSalesSnapshot = isset($snapshot['recentSales']) && is_array($snapshot['recentSales']) ? $snapshot['recentSales'] : array();
    foreach ($recentSalesSnapshot as $sale) {
        $dogNumber = isset($sale['dogNumber']) ? intval($sale['dogNumber']) : null;
        $priceDoge = normalizeNumber(isset($sale['priceDoge']) ? $sale['priceDoge'] : null);
        if ($dogNumber === null || $dogNumber < 1 || $priceDoge === null || $priceDoge <= 0) {
            continue;
        }

        $saleTraits = getDogTraitsRecord($dogNumber);
        if (!is_array($saleTraits)) {
            continue;
        }

        foreach ($TRAIT_KEYS as $traitKey) {
            $traitValue = isset($saleTraits[$traitKey]) ? $saleTraits[$traitKey] : null;
            if ($traitValue === null || $traitValue === '') {
                continue;
            }

            $trendKey = $traitKey . ':' . $traitValue;
            $rawTopSaleMap[$trendKey] = isset($rawTopSaleMap[$trendKey])
                ? max($rawTopSaleMap[$trendKey], $priceDoge)
                : $priceDoge;
        }
    }

    $traits = array();
    $traitCounts = isset($snapshot['traitMeta']['counts']) && is_array($snapshot['traitMeta']['counts'])
        ? $snapshot['traitMeta']['counts']
        : array();
    foreach ($TRAIT_KEYS as $traitKey) {
        $category = traitCategoryLabel($traitKey);
        $values = isset($traitCounts[$category]) && is_array($traitCounts[$category]) ? $traitCounts[$category] : array();

        foreach ($values as $value => $count) {
            $trendKey = $traitKey . ':' . $value;
            $listingStats = isset($snapshot['traitStats'][$traitKey][$value]) ? $snapshot['traitStats'][$traitKey][$value] : array();
            $saleStats = isset($snapshot['saleTraitStats'][$traitKey][$value]) ? $snapshot['saleTraitStats'][$traitKey][$value] : array();
            $autoEntry = isset($summary['autoMultipliers'][$trendKey]) ? $summary['autoMultipliers'][$trendKey] : null;
            $effectiveEntry = isset($summary['effectiveMultipliers'][$trendKey]) ? $summary['effectiveMultipliers'][$trendKey] : null;
            $traitCount = intval($count);
            $listed = isset($listingStats['listed']) ? intval($listingStats['listed']) : 0;
            $saleCount = isset($saleStats['count']) ? intval($saleStats['count']) : 0;
            $floorDoge = isset($listingStats['floor']) ? normalizeNumber($listingStats['floor']) : null;
            $saleFloorDoge = isset($saleStats['floor']) ? normalizeNumber($saleStats['floor']) : null;
            $saleMedianDoge = isset($saleStats['median']) ? normalizeNumber($saleStats['median']) : null;
            $topSaleDoge = isset($rawTopSaleMap[$trendKey]) ? normalizeNumber($rawTopSaleMap[$trendKey]) : null;
            if (!($topSaleDoge === null || in_array($value, array('Diamond', 'Shiny'), true) || $traitCount <= 100)) {
                if ($traitCount <= 500) {
                    if ($saleMedianDoge !== null) {
                        $cap = max($saleMedianDoge * 2, $floorDoge !== null ? $floorDoge : 0);
                        $topSaleDoge = min($topSaleDoge, $cap);
                    }
                } elseif ($saleMedianDoge !== null) {
                    $topSaleDoge = $saleMedianDoge;
                }
            }

            $autoMetrics = array(
                'salesPercent' => $traitCount > 0 ? round($saleCount / $traitCount, 4) : null,
                'listedPercent' => $traitCount > 0 ? round($listed / $traitCount, 4) : null,
            );
            $source = ($effectiveEntry && isset($effectiveEntry['source'])) ? $effectiveEntry['source'] : (isset($suppressedTrendKeys[$trendKey]) ? 'suppressed' : 'none');
            $baseSignal = $describeBasePriceSignal(array(
                'traitCount' => $traitCount,
                'listed' => $listed,
                'saleCount' => $saleCount,
                'floorDoge' => $floorDoge,
                'saleFloorDoge' => $saleFloorDoge,
                'saleMedianDoge' => $saleMedianDoge,
                'topSaleDoge' => $topSaleDoge,
            ));

            $traits[] = array(
                'trendKey' => $trendKey,
                'trait' => $traitKey,
                'value' => $value,
                'traitCount' => $traitCount,
                'rarityBand' => $classifyTraitRarityBand($traitCount),
                'listed' => $listed,
                'saleCount' => $saleCount,
                'floorDoge' => $floorDoge,
                'floorUsd' => ($floorDoge !== null && $liveDogeUsd !== null) ? round($floorDoge * $liveDogeUsd, 2) : null,
                'listingMedianDoge' => isset($listingStats['median']) ? normalizeNumber($listingStats['median']) : null,
                'listingMeanDoge' => isset($listingStats['mean']) ? normalizeNumber($listingStats['mean']) : null,
                'saleFloorDoge' => $saleFloorDoge,
                'saleMedianDoge' => $saleMedianDoge,
                'topSaleDoge' => $topSaleDoge,
                'topSaleUsd' => ($topSaleDoge !== null && $liveDogeUsd !== null) ? round($topSaleDoge * $liveDogeUsd, 2) : null,
                'manualMultiplier' => isset($summary['manualMultipliers'][$trendKey]) ? $summary['manualMultipliers'][$trendKey] : null,
                'autoMultiplier' => ($autoEntry && isset($autoEntry['multiplier'])) ? $autoEntry['multiplier'] : null,
                'autoMetrics' => $autoMetrics,
                'autoSuppressed' => isset($suppressedTrendKeys[$trendKey]),
                'effectiveMultiplier' => ($effectiveEntry && isset($effectiveEntry['multiplier'])) ? $effectiveEntry['multiplier'] : 1,
                'source' => $source,
                'trendReason' => $formatTrendReason(array(
                    'manualMultiplier' => isset($summary['manualMultipliers'][$trendKey]) ? $summary['manualMultipliers'][$trendKey] : null,
                    'autoMultiplier' => ($autoEntry && isset($autoEntry['multiplier'])) ? $autoEntry['multiplier'] : null,
                    'autoMetrics' => $autoMetrics,
                    'autoSuppressed' => isset($suppressedTrendKeys[$trendKey]),
                    'source' => $source,
                )),
                'baseProfile' => $baseSignal['baseProfile'],
                'baseReason' => $baseSignal['baseReason'],
                'baseSignalSource' => $baseSignal['baseSignalSource'],
                'baseSignalDoge' => $baseSignal['baseSignalDoge'],
                'baseSignalUsd' => ($baseSignal['baseSignalDoge'] !== null && $liveDogeUsd !== null) ? round($baseSignal['baseSignalDoge'] * $liveDogeUsd, 2) : null,
                'marketEvidenceCount' => $baseSignal['marketEvidenceCount'],
            );
        }
    }

    usort($traits, function ($left, $right) {
        $countDiff = intval($left['traitCount']) - intval($right['traitCount']);
        if ($countDiff !== 0) {
            return $countDiff;
        }

        $traitDiff = strcmp(strval($left['trait']), strval($right['trait']));
        if ($traitDiff !== 0) {
            return $traitDiff;
        }

        return strcmp(strval($left['value']), strval($right['value']));
    });

    $trendingTraits = array_values(array_filter($traits, function ($entry) {
        return (isset($entry['source']) && $entry['source'] !== 'none')
            || !empty($entry['autoSuppressed'])
            || (isset($entry['autoMultiplier']) && $entry['autoMultiplier'] !== null);
    }));
    usort($trendingTraits, function ($left, $right) {
        $effectiveDiff = floatval(isset($right['effectiveMultiplier']) ? $right['effectiveMultiplier'] : 0) <=> floatval(isset($left['effectiveMultiplier']) ? $left['effectiveMultiplier'] : 0);
        if ($effectiveDiff !== 0) {
            return $effectiveDiff;
        }

        $autoDiff = floatval(isset($right['autoMultiplier']) ? $right['autoMultiplier'] : 0) <=> floatval(isset($left['autoMultiplier']) ? $left['autoMultiplier'] : 0);
        if ($autoDiff !== 0) {
            return $autoDiff;
        }

        $countDiff = intval(isset($left['traitCount']) ? $left['traitCount'] : 0) - intval(isset($right['traitCount']) ? $right['traitCount'] : 0);
        if ($countDiff !== 0) {
            return $countDiff;
        }

        $traitDiff = strcmp(strval($left['trait']), strval($right['trait']));
        if ($traitDiff !== 0) {
            return $traitDiff;
        }

        return strcmp(strval($left['value']), strval($right['value']));
    });

    $basePriceTraits = array_values(array_filter($traits, function ($entry) {
        return isset($entry['baseProfile']) && $entry['baseProfile'] !== 'unpriced';
    }));
    usort($basePriceTraits, function ($left, $right) {
        $signalDiff = floatval(isset($right['baseSignalDoge']) ? $right['baseSignalDoge'] : 0) <=> floatval(isset($left['baseSignalDoge']) ? $left['baseSignalDoge'] : 0);
        if ($signalDiff !== 0) {
            return $signalDiff;
        }

        $countDiff = intval(isset($left['traitCount']) ? $left['traitCount'] : 0) - intval(isset($right['traitCount']) ? $right['traitCount'] : 0);
        if ($countDiff !== 0) {
            return $countDiff;
        }

        $traitDiff = strcmp(strval($left['trait']), strval($right['trait']));
        if ($traitDiff !== 0) {
            return $traitDiff;
        }

        return strcmp(strval($left['value']), strval($right['value']));
    });

    return array(
        'generatedAt' => gmdate('c'),
        'snapshot' => array(
            'builtAt' => isset($snapshot['builtAt']) ? $snapshot['builtAt'] : gmdate('c'),
            'totalListed' => isset($snapshot['collectionStats']['totalListed']) ? intval($snapshot['collectionStats']['totalListed']) : 0,
            'dogeUsd' => $liveDogeUsd,
        ),
        'config' => $config,
        'communityOffers' => $communityOffers,
        'recentEvaluations' => $recentEvaluations,
        'trendingTraits' => $trendingTraits,
        'basePriceTraits' => $basePriceTraits,
        'traits' => $traits,
    );
}

function getWalletHoldingsSummary($address) {
    $walletData = getWalletData($address);
    $holdings = isset($walletData['holdings']) && is_array($walletData['holdings']) ? $walletData['holdings'] : array();
    $dogNumbers = array();
    $seen = array();

    foreach ($holdings as $holding) {
        $dogNumber = isset($holding['dogId']) ? intval($holding['dogId']) : 0;
        $imageUrl = isset($holding['imageUrl']) ? strval($holding['imageUrl']) : '';
        if ($dogNumber < 1 || $dogNumber > 10000 || isset($seen[$dogNumber])) {
            continue;
        }
        if ($imageUrl !== '' && stripos($imageUrl, '/dogs/') !== 0) {
            continue;
        }

        $seen[$dogNumber] = true;
        $dogNumbers[] = $dogNumber;
    }

    sort($dogNumbers);
    $profile = getWalletProfileSummary($address, $dogNumbers);

    return array(
        'address' => $address,
        'totalHoldings' => count($holdings),
        'totalDogs' => count($dogNumbers),
        'nonDoginalHoldings' => max(0, count($holdings) - count($dogNumbers)),
        'dogNumbers' => $dogNumbers,
        'balance' => isset($walletData['balance']) && is_array($walletData['balance']) ? $walletData['balance'] : null,
        'collections' => isset($walletData['collections']) && is_array($walletData['collections']) ? $walletData['collections'] : array(),
        'profile' => $profile,
        'evaluatedAt' => gmdate('c')
    );
}

function evaluateDog($dogNumber) {
    global $TRAIT_KEYS;

    $displayOverride = getDogDisplayOverride($dogNumber);
    $trendingConfig = getTrendingConfigData(true);
    $refusedOfferFloor = isset($trendingConfig['refusedOffers'][strval($dogNumber)]) ? $trendingConfig['refusedOffers'][strval($dogNumber)] : null;

    $traits = getDogTraitsRecord($dogNumber);
    if (!$traits) {
        throw new Exception('Could not fetch traits for this dog.');
    }

    $search = getSearchResult($dogNumber);

    $communityLore = null;
    $notesStore = readCommunityNotesStorePhp();
    $nmap = isset($notesStore['notes']) && is_array($notesStore['notes']) ? $notesStore['notes'] : array();
    $communityLore = lookupCommunityLoreInNotesMapPhp($nmap, $dogNumber);

    $traitStats = array();
    $traitMeta = array('counts' => array());
    $recentSales = array();
    $saleTraitStats = array();
    $dogeUsd = null;
    $collectionFloor = null;

    try {
        $marketSnapshot = getTraitMarketSnapshot();
        $traitStats = isset($marketSnapshot['traitStats']) ? $marketSnapshot['traitStats'] : array();
        $traitMeta = isset($marketSnapshot['traitMeta']) ? $marketSnapshot['traitMeta'] : array('counts' => array());
        $recentSales = isset($marketSnapshot['recentSales']) ? $marketSnapshot['recentSales'] : array();
        $saleTraitStats = isset($marketSnapshot['saleTraitStats']) ? $marketSnapshot['saleTraitStats'] : array();
        $dogeUsd = isset($marketSnapshot['dogeUsd']) ? $marketSnapshot['dogeUsd'] : null;
        $collectionFloor = isset($marketSnapshot['collectionStats']['floor']) ? normalizeNumber($marketSnapshot['collectionStats']['floor']) : null;
    } catch (Exception $e) {
        $traitStats = array();
        $traitMeta = array('counts' => array());
        $recentSales = array();
        $saleTraitStats = array();
    }

    if ($dogeUsd === null) {
        try {
            $dogeUsd = getDogecoinPrice();
        } catch (Exception $e) {
            $dogeUsd = null;
        }
    }

    if ($collectionFloor === null) {
        try {
            $floorListing = getFloorListing();
            $collectionFloor = $floorListing ? normalizeNumber(isset($floorListing['priceDoge']) ? $floorListing['priceDoge'] : null) : null;
        } catch (Exception $e) {
            $collectionFloor = null;
        }
    }

    $traitCounts = isset($traitMeta['counts']) && is_array($traitMeta['counts']) ? $traitMeta['counts'] : array();
    if (count($traitCounts) === 0) {
        try {
            $traitCounts = getTraitCounts();
            $traitMeta = array('counts' => $traitCounts);
        } catch (Exception $e) {
            $traitCounts = array();
        }
    }

    if (count($recentSales) === 0) {
        try {
            $recentSales = getRecentSales(100);
        } catch (Exception $e) {
            $recentSales = array();
        }
    }

    if (count($saleTraitStats) === 0 && count($recentSales) > 0) {
        try {
            $saleTraitStats = buildSaleTraitMap($recentSales);
        } catch (Exception $e) {
            $saleTraitStats = array();
        }
    }

    // Check if THIS dog has a recent sale
    $ownTopSale = null;
    foreach ($recentSales as $sale) {
        if ($sale['dogNumber'] === $dogNumber) {
            if ($ownTopSale === null || $sale['priceDoge'] > $ownTopSale) {
                $ownTopSale = $sale['priceDoge'];
            }
        }
    }

    // Map trait keys to the API count key names
    $keyMap = array(
        'furColor' => 'Fur Color',
        'furPattern' => 'Fur Pattern',
        'background' => 'Background',
        'head' => 'Head',
        'clothes' => 'Clothes',
        'mouth' => 'Mouth',
        'eyes' => 'Eyes',
        'accessory' => 'Accessory',
    );

    $traitBreakdown = array();

    foreach ($TRAIT_KEYS as $key) {
        $value = isset($traits[$key]) ? $traits[$key] : null;
        if ($value === null || $value === '') {
            continue;
        }

        $listingStats = isset($traitStats[$key][$value]) ? $traitStats[$key][$value] : null;
        $floor = $listingStats && isset($listingStats['floor']) ? normalizeNumber($listingStats['floor']) : null;
        if ($floor === null) {
            try {
                $listing = getFloorListing(array($key => array($value)));
                if ($listing) {
                    $floor = normalizeNumber(isset($listing['priceDoge']) ? $listing['priceDoge'] : null);
                }
            } catch (Exception $e) {
                $floor = null;
            }
        }

        // Look up sale stats for this trait value
        $saleStats = isset($saleTraitStats[$key][$value]) ? $saleTraitStats[$key][$value] : null;
        $saleFloor = $saleStats ? $saleStats['floor'] : null;
        $saleMedian = $saleStats ? $saleStats['median'] : null;
        $topSale = $saleStats ? $saleStats['topSale'] : null;
        $saleCount = $saleStats ? $saleStats['count'] : 0;

        // Trait rarity count
        $apiKey = isset($keyMap[$key]) ? $keyMap[$key] : ucfirst($key);
        $traitCount = isset($traitCounts[$apiKey][$value]) ? intval($traitCounts[$apiKey][$value]) : null;

        // Tiered topSale cap based on trait rarity so a Diamond dog's sale
        // doesn't inflate moderately-rare traits like Cowboy hat.
        // Always keep full topSale for Diamond, Shiny, or ultra-rare (count <= 100)
        $alwaysRare = array('Diamond', 'Shiny');
        if (in_array($value, $alwaysRare) || ($traitCount !== null && $traitCount <= 100)) {
            // Truly rare — keep full topSale
        } elseif ($traitCount !== null && $traitCount <= 500) {
            // Moderately rare — cap at 2× median or listing floor, whichever is higher
            if ($topSale !== null && $saleMedian !== null) {
                $cap = max($saleMedian * 2, $floor !== null ? $floor : 0);
                $topSale = min($topSale, $cap);
            }
        } else {
            // Common trait — cap at median
            if ($topSale !== null && $saleMedian !== null) {
                $topSale = $saleMedian;
            }
        }

        $entry = array(
            'trait' => $key,
            'value' => $value,
            'floor' => $floor,
            'median' => $listingStats && isset($listingStats['median']) ? $listingStats['median'] : $floor,
            'mean' => $listingStats && isset($listingStats['mean']) ? $listingStats['mean'] : $floor,
            'listed' => $listingStats && isset($listingStats['listed']) ? intval($listingStats['listed']) : ($floor === null ? 0 : 1),
            'saleFloor' => $saleFloor,
            'saleMedian' => $saleMedian,
            'saleCount' => $saleCount,
            'topSale' => $topSale,
            'traitCount' => $traitCount,
            'isTopSale' => false,
        );

        if ($floor === null && $saleCount === 0) {
            $entry['note'] = 'No active listings or recent sales with this trait value';
        }

        $traitBreakdown[] = $entry;
    }

    applyTraitDisplayOverrides($traitBreakdown, $displayOverride);
    usort($traitBreakdown, function ($left, $right) use ($TRAIT_KEYS) {
        return array_search($left['trait'], $TRAIT_KEYS, true) - array_search($right['trait'], $TRAIT_KEYS, true);
    });

    // Identify the rarest trait (lowest traitCount)
    $rarestIdx = null;
    $rarestCount = PHP_INT_MAX;
    foreach ($traitBreakdown as $i => $tb) {
        if (!empty($tb['isSynthetic'])) {
            continue;
        }
        if ($tb['traitCount'] !== null && $tb['traitCount'] < $rarestCount) {
            $rarestCount = $tb['traitCount'];
            $rarestIdx = $i;
        }
    }
    $rarestTrait = $rarestIdx !== null ? $traitBreakdown[$rarestIdx] : null;

    // Find the highest top-sale price across all traits for "TOP SALE" badge
    $globalTopSalePrice = 0;
    foreach ($traitBreakdown as $tb) {
        if ($tb['topSale'] !== null && $tb['topSale'] > $globalTopSalePrice) {
            $globalTopSalePrice = $tb['topSale'];
        }
    }
    // Mark traits that hold a significant top sale (exclude background & eyes)
    $topSaleExcluded = array('background', 'eyes');
    if ($globalTopSalePrice > 0) {
        $topSaleThreshold = $globalTopSalePrice * 0.5;
        foreach ($traitBreakdown as &$tb) {
            if (!in_array($tb['trait'], $topSaleExcluded) && $tb['topSale'] !== null && $tb['topSale'] >= $topSaleThreshold) {
                $tb['isTopSale'] = true;
            }
        }
        unset($tb);
    }

    $trendSummary = buildTrendingSummary($traitStats, $saleTraitStats, $traitMeta);

    $trendingMultiplier = 1.0;
    $trendingHits = array();
    foreach ($traitBreakdown as &$tb) {
        $trendKey = $tb['trait'] . ':' . $tb['value'];
        if (isset($trendSummary['effectiveMultipliers'][$trendKey])) {
            $trendInfo = $trendSummary['effectiveMultipliers'][$trendKey];
            $mult = $trendInfo['multiplier'];
            $tb['trending'] = $mult;
            $tb['trendSource'] = isset($trendInfo['source']) ? $trendInfo['source'] : 'manual';
            $trendingHits[] = array(
                'trait' => $tb['trait'],
                'value' => $tb['value'],
                'multiplier' => $mult,
                'source' => isset($trendInfo['source']) ? $trendInfo['source'] : 'manual'
            );
            if ($mult > $trendingMultiplier) $trendingMultiplier = $mult;
        }
    }
    unset($tb);

    // --- Valuation logic ---
    // Compound anchor: max(blend) over top-N rarest traits (supply <= cap).
    $compoundResult = compute_compound_anchor_base_php($traitBreakdown);
    $basePriceDoge = $compoundResult['basePriceDoge'];
    $compoundIndices = isset($compoundResult['compoundIndices']) ? $compoundResult['compoundIndices'] : array();

    $rarestTraitThinMarketBoost = null;
    $winningCompound = isset($compoundResult['winningTrait']) ? $compoundResult['winningTrait'] : null;
    if ($winningCompound && qualifies_rarest_trait_thin_market_boost_php($winningCompound)) {
        $thinBoost = 1.08;
        if ($basePriceDoge !== null && $basePriceDoge > 0) {
            $basePriceDoge = $basePriceDoge * $thinBoost;
            $rarestTraitThinMarketBoost = $thinBoost;
        }
    }
    if ($basePriceDoge === null && $rarestTrait && qualifies_rarest_trait_thin_market_boost_php($rarestTrait)
        && $collectionFloor !== null && $collectionFloor > 0) {
        $thinBoost = 1.08;
        $basePriceDoge = $collectionFloor * $thinBoost;
        $rarestTraitThinMarketBoost = $thinBoost;
    }

    // This inscription's own sale clears at least that price — floors base
    if ($ownTopSale !== null) {
        $basePriceDoge = $basePriceDoge !== null ? max($basePriceDoge, $ownTopSale) : $ownTopSale;
    }

    // Other RARE traits can raise the value (skip common ones with count > 500; skip compound-anchor layers)
    $traitBonus = 0;
    foreach ($traitBreakdown as $i => $tb) {
        if (isset($compoundIndices[$i])) {
            continue;
        }
        if (!empty($tb['isSynthetic'])) {
            continue;
        }
        if ($tb['traitCount'] === null || $tb['traitCount'] > 500) {
            continue;
        }
        $tbPrice = $tb['topSale'] !== null ? $tb['topSale'] : $tb['floor'];
        if ($tbPrice !== null && $basePriceDoge !== null && $tbPrice > $basePriceDoge) {
            $traitBonus += ($tbPrice - $basePriceDoge) * 0.2;
        }
    }

    // Fallback: if the unfiltered listings call returned nothing, derive
    // collection floor from the minimum per-trait floor we already fetched.
    $traitFloorValues = array();
    foreach ($traitBreakdown as $tb) {
        if ($tb['floor'] !== null) $traitFloorValues[] = $tb['floor'];
    }
    if ($collectionFloor === null && count($traitFloorValues) > 0) {
        $collectionFloor = min($traitFloorValues);
    }

    $rank = isset($traits['rarityRank']) && intval($traits['rarityRank']) > 0
        ? intval($traits['rarityRank'])
        : 5000;
    $rankPct = $rank / 10000.0;
    $rarityMultiplier = 1.0;
    if ($rankPct <= 0.01) {
        $rarityMultiplier = 1.5;
    } elseif ($rankPct <= 0.05) {
        $rarityMultiplier = 1.25;
    } elseif ($rankPct <= 0.15) {
        $rarityMultiplier = 1.1;
    } elseif ($rankPct <= 0.25) {
        $rarityMultiplier = 1.05;
    }

    $estimatedDoge = null;
    if ($basePriceDoge !== null) {
        $estimatedDoge = intval(round(($basePriceDoge + $traitBonus) * $rarityMultiplier * $trendingMultiplier));
    } else {
        // Fallback: average of available floors × rarity
        if (count($traitFloorValues) > 0) {
            $estimatedDoge = intval(round(meanValue($traitFloorValues) * $rarityMultiplier * $trendingMultiplier));
        }
    }

    // Never estimate below collection floor
    if ($estimatedDoge !== null && $collectionFloor !== null && $estimatedDoge < $collectionFloor) {
        $estimatedDoge = intval($collectionFloor);
    }

    $unlistedTraits = 0;
    foreach ($traitBreakdown as $entry) {
        if (!empty($entry['isSynthetic'])) {
            continue;
        }
        if ($entry['floor'] === null && $entry['saleCount'] === 0) {
            $unlistedTraits++;
        }
    }

    if ($unlistedTraits >= 3 && $estimatedDoge !== null) {
        $estimatedDoge = intval(round($estimatedDoge * 1.15));
    }

    $valueMultiplier = resolveValueMultiplier($traitBreakdown, $displayOverride);
    if ($estimatedDoge !== null && $valueMultiplier !== 1.0) {
        $estimatedDoge = intval(round($estimatedDoge * $valueMultiplier));
    }

    // --- Color match metric ---
    $colorTraitMap = array();
    foreach ($traitBreakdown as $tb) {
        if (!empty($tb['isSynthetic'])) continue;
        $color = extractDominantColor(isset($tb['value']) ? $tb['value'] : null);
        if ($color !== null) {
            if (!isset($colorTraitMap[$color])) $colorTraitMap[$color] = array();
            if (!in_array($tb['trait'], $colorTraitMap[$color], true)) {
                $colorTraitMap[$color][] = $tb['trait'];
            }
        }
    }
    // Also apply directly to background/furColor values (may just be a bare color name)
    foreach (array('background', 'furColor') as $key) {
        $val = isset($traits[$key]) ? $traits[$key] : null;
        $color = extractDominantColor($val);
        if ($color !== null) {
            if (!isset($colorTraitMap[$color])) $colorTraitMap[$color] = array();
            if (!in_array($key, $colorTraitMap[$color], true)) {
                $colorTraitMap[$color][] = $key;
            }
        }
    }
    $colorMatch = null;
    foreach ($colorTraitMap as $color => $traitKeys) {
        if (count($traitKeys) >= 2) {
            $colorMatch = array('color' => $color, 'traits' => $traitKeys);
            break;
        }
    }
    // Suppress color match on Black Classic dogs — already captured by the minimal-dog multiplier.
    $isBlackClassicEarly = isset($traits['furColor']) && isset($traits['furPattern']) &&
        strtolower($traits['furColor']) === 'black' && strtolower($traits['furPattern']) === 'classic';
    if ($isBlackClassicEarly && $colorMatch !== null && $colorMatch['color'] === 'black') {
        $colorMatch = null;
    }

    // Read special multiplier config (falls back to defaults if absent)
    $smConfig = isset($trendingConfig['specialMultipliers']) ? $trendingConfig['specialMultipliers'] : array();
    $cmConfig = isset($smConfig['colorMatch']) ? $smConfig['colorMatch'] : array();
    $specialMultiplierDetails = array();
    if ($colorMatch !== null && isset($cmConfig['enabled']) && !$cmConfig['enabled']) {
        $colorMatch = null;
    }
    $colorMatchMultiplier = $colorMatch !== null ? max(1.0, isset($cmConfig['multiplier']) ? floatval($cmConfig['multiplier']) : 1.10) : 1.0;
    if ($colorMatch !== null && $estimatedDoge !== null) {
        $estimatedDoge = intval(round($estimatedDoge * $colorMatchMultiplier));
        $specialMultiplierDetails[] = array(
            'type' => 'color_match',
            'label' => '🎨 ' . ucfirst($colorMatch['color']) . ' Match',
            'multiplier' => $colorMatchMultiplier,
        );
    }

    // --- Minimal dog metric ---
    $minimalBaseKeys = array('background', 'furColor', 'furPattern', 'head');
    $minimalMetaKeys = array('rarityRank', 'traitCounts');
    $extraTraitCount = 0;
    foreach ($traits as $k => $v) {
        if (!in_array($k, $minimalBaseKeys) && !in_array($k, $minimalMetaKeys) && $v !== null && trim((string)$v) !== '') {
            $extraTraitCount++;
        }
    }
    $hasVisor = isset($traits['eyes']) && $traits['eyes'] !== null && stripos($traits['eyes'], 'visor') !== false;
    $isBlackClassic = isset($traits['furColor']) && isset($traits['furPattern']) &&
        strtolower($traits['furColor']) === 'black' && strtolower($traits['furPattern']) === 'classic';

    $smTiers = isset($smConfig['minimalTiers']) ? $smConfig['minimalTiers'] : array();
    $getTierMult = function($id, $fallback) use ($smTiers) {
        $t = isset($smTiers[$id]) ? $smTiers[$id] : array();
        if (isset($t['enabled']) && !$t['enabled']) return 1.0;
        return max(1.0, isset($t['multiplier']) ? floatval($t['multiplier']) : $fallback);
    };

    $minimalMultiplier = 1.0;
    $minimalType = null;
    $minimalLabel = null;
    if ($isBlackClassic && $hasVisor) {
        $m = $getTierMult('black_classic_visor', 1.20);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'black_classic_visor'; $minimalLabel = '🎨 Black Classic Visor'; }
    } elseif ($isBlackClassic) {
        $m = $getTierMult('black_classic', 1.15);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'black_classic'; $minimalLabel = '🎨 Black Classic'; }
    } elseif ($hasVisor && $extraTraitCount === 1) {
        $m = $getTierMult('visor_minimal', 1.15);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'visor_minimal'; $minimalLabel = '✨ Visor'; }
    } elseif ($extraTraitCount === 0) {
        $m = $getTierMult('ultra_clean', 1.10);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'ultra_clean'; $minimalLabel = '✨ Ultra Clean'; }
    } elseif ($extraTraitCount === 1) {
        $m = $getTierMult('minimal_1', 1.05);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'minimal_1'; $minimalLabel = '✨ Minimal'; }
    } elseif ($extraTraitCount === 2) {
        $m = $getTierMult('minimal_2', 1.01);
        if ($m > 1.0) { $minimalMultiplier = $m; $minimalType = 'minimal_2'; $minimalLabel = '✨ Minimal'; }
    }
    $isMinimalDog = $minimalMultiplier > 1.0;
    if ($isMinimalDog && $estimatedDoge !== null) {
        $estimatedDoge = intval(round($estimatedDoge * $minimalMultiplier));
        $specialMultiplierDetails[] = array(
            'type' => $minimalType,
            'label' => $minimalLabel,
            'multiplier' => $minimalMultiplier,
        );
    }

    // --- Custom combo multipliers (Any = trait present any value; None = empty slot) ---
    $smCombos = isset($smConfig['combos']) && is_array($smConfig['combos']) ? $smConfig['combos'] : array();
    $comboMultiplier = 1.0;
    $matchedCombos = array();
    foreach ($smCombos as $combo) {
        if (!is_array($combo)) {
            continue;
        }
        if (isset($combo['enabled']) && !$combo['enabled']) {
            continue;
        }
        $conditions = isset($combo['conditions']) && is_array($combo['conditions']) ? $combo['conditions'] : array();
        if (empty($conditions)) {
            continue;
        }
        $allMatch = true;
        foreach ($conditions as $cond) {
            $traitName = isset($cond['trait']) ? $cond['trait'] : '';
            $val = isset($traits[$traitName]) ? $traits[$traitName] : null;
            $present = ($val !== null && trim(strval($val)) !== '');
            $sv = $present ? strtolower(trim(strval($val))) : '';
            $cv = strtolower(trim(isset($cond['value']) ? strval($cond['value']) : ''));
            if ($cv === '') {
                $allMatch = false;
                break;
            }
            if ($cv === 'any') {
                if (!$present) {
                    $allMatch = false;
                    break;
                }
                continue;
            }
            if ($cv === 'none') {
                if ($present) {
                    $allMatch = false;
                    break;
                }
                continue;
            }
            if (!$present) {
                $allMatch = false;
                break;
            }
            if (isset($cond['op']) && $cond['op'] === 'contains') {
                if (strpos($sv, $cv) === false) {
                    $allMatch = false;
                    break;
                }
            } elseif ($sv !== $cv) {
                $allMatch = false;
                break;
            }
        }
        if ($allMatch) {
            $cmRaw = isset($combo['multiplier']) ? floatval($combo['multiplier']) : 0.0;
            if (!is_finite($cmRaw) || $cmRaw == 0.0) {
                continue;
            }
            $factor = normalize_signed_price_multiplier_php($cmRaw);
            if ($factor == 1.0) {
                continue;
            }
            $comboMultiplier *= $factor;
            $matchedCombos[] = $combo;
        }
    }
    if (count($matchedCombos) > 0 && $estimatedDoge !== null && $comboMultiplier != 1.0) {
        $comboLabels = array();
        foreach ($matchedCombos as $c) {
            if (isset($c['label']) && trim(strval($c['label'])) !== '') {
                $comboLabels[] = strval($c['label']);
            }
        }
        $comboDisplayLabel = count($comboLabels) > 0 ? implode(' · ', $comboLabels) : 'Combo stack';
        $estimatedDoge = intval(round($estimatedDoge * $comboMultiplier));
        $specialMultiplierDetails[] = array(
            'type' => 'combo',
            'label' => $comboDisplayLabel,
            'multiplier' => $comboMultiplier,
        );
    }

    if (count($matchedCombos) > 0) {
        $comboLabels = array();
        foreach ($matchedCombos as $c) {
            if (isset($c['label']) && trim(strval($c['label'])) !== '') {
                $comboLabels[] = strval($c['label']);
            }
        }
        $comboLabel = count($comboLabels) > 0 ? implode(' · ', $comboLabels) : 'Combo';
        $comboId = count($matchedCombos) === 1 && isset($matchedCombos[0]['id']) ? strval($matchedCombos[0]['id']) : 'combo-stack';
        foreach ($traitBreakdown as &$tb) {
            if (!empty($tb['isSynthetic'])) {
                continue;
            }
            $hit = false;
            foreach ($matchedCombos as $matchedCombo) {
                $comboConds = isset($matchedCombo['conditions']) && is_array($matchedCombo['conditions']) ? $matchedCombo['conditions'] : array();
                foreach ($comboConds as $cond) {
                    if (!is_array($cond) || !isset($cond['trait']) || $cond['trait'] !== $tb['trait']) {
                        continue;
                    }
                    $val = isset($traits[$tb['trait']]) ? $traits[$tb['trait']] : null;
                    $present = ($val !== null && trim(strval($val)) !== '');
                    $sv = $present ? strtolower(trim(strval($val))) : '';
                    $cv = strtolower(trim(isset($cond['value']) ? strval($cond['value']) : ''));
                    if ($cv === '') {
                        continue;
                    }
                    if ($cv === 'any') {
                        if ($present) {
                            $hit = true;
                            break 2;
                        }
                        continue;
                    }
                    if ($cv === 'none') {
                        if (!$present) {
                            $hit = true;
                            break 2;
                        }
                        continue;
                    }
                    if (!$present) {
                        continue;
                    }
                    $isContains = isset($cond['op']) && $cond['op'] === 'contains';
                    if ($isContains ? (strpos($sv, $cv) !== false) : ($sv === $cv)) {
                        $hit = true;
                        break 2;
                    }
                }
            }
            if ($hit) {
                $tb['comboPart'] = array(
                    'id' => $comboId,
                    'label' => $comboLabel,
                );
            }
        }
        unset($tb);
    }

    // --- Angel numbers (quad/triple repeaters + trend numbers) ---
    $smAngel = isset($smConfig['angelNumbers']) && is_array($smConfig['angelNumbers']) ? $smConfig['angelNumbers'] : array();
    $angelMultiplier = 1.0;
    $angelType = null;
    $angelLabel = null;

    // Check for quad repeater (1111-9999)
    $dogNumStr = strval($dogNumber);
    $isQuadRepeater = strlen($dogNumStr) === 4 && preg_match('/^(.)\1{3}$/', $dogNumStr);
    if ($isQuadRepeater) {
        $quadConfig = isset($smAngel['quadRepeater']) && is_array($smAngel['quadRepeater']) ? $smAngel['quadRepeater'] : array();
        if (!isset($quadConfig['enabled']) || (bool)$quadConfig['enabled']) {
            $m = max(1.0, isset($quadConfig['multiplier']) ? floatval($quadConfig['multiplier']) : 1.25);
            if ($m > $angelMultiplier) { $angelMultiplier = $m; $angelType = 'quad_repeater'; $angelLabel = '🔢 Quad ' . $dogNumStr[0]; }
        }
    }

    // Check for triple repeater (111-999)
    $isTripleRepeater = strlen($dogNumStr) === 3 && preg_match('/^(.)\1{2}$/', $dogNumStr);
    if ($isTripleRepeater) {
        $tripleConfig = isset($smAngel['tripleRepeater']) && is_array($smAngel['tripleRepeater']) ? $smAngel['tripleRepeater'] : array();
        if (!isset($tripleConfig['enabled']) || (bool)$tripleConfig['enabled']) {
            $m = max(1.0, isset($tripleConfig['multiplier']) ? floatval($tripleConfig['multiplier']) : 1.15);
            if ($m > $angelMultiplier) { $angelMultiplier = $m; $angelType = 'triple_repeater'; $angelLabel = '🔢 Triple ' . $dogNumStr[0]; }
        }
    }

    // Exact-match vanity dog numbers from admin table (capped at ×1.2 in config)
    $trendNumConfig = isset($smAngel['trendNumbers']) && is_array($smAngel['trendNumbers']) ? $smAngel['trendNumbers'] : array();
    if (isset($trendNumConfig[$dogNumStr]) && is_array($trendNumConfig[$dogNumStr])) {
        $tnConf = $trendNumConfig[$dogNumStr];
        if (!isset($tnConf['enabled']) || (bool)$tnConf['enabled']) {
            $m = max(1.0, min(1.2, isset($tnConf['multiplier']) ? floatval($tnConf['multiplier']) : 1.05));
            if ($m > $angelMultiplier) {
                $angelMultiplier = $m;
                $angelType = 'trend_number';
                $angelLabel = '🔢 ' . $dogNumStr;
            }
        }
    }

    $isAngelNumber = $angelMultiplier > 1.0;
    if ($isAngelNumber && $estimatedDoge !== null) {
        $estimatedDoge = intval(round($estimatedDoge * $angelMultiplier));
        $specialMultiplierDetails[] = array(
            'type' => $angelType,
            'label' => $angelLabel,
            'multiplier' => $angelMultiplier,
        );
    }

    $refusedOfferValue = null;
    if ($refusedOfferFloor !== null) {
        if (isset($refusedOfferFloor['minOfferDoge']) && intval($refusedOfferFloor['minOfferDoge']) > 0) {
            $refusedOfferValue = intval($refusedOfferFloor['minOfferDoge']);
        } elseif (isset($refusedOfferFloor['minOfferUsd']) && $dogeUsd !== null && $dogeUsd > 0) {
            $refusedOfferValue = intval(round(floatval($refusedOfferFloor['minOfferUsd']) / $dogeUsd));
        }
    }

    if ($refusedOfferValue !== null && $refusedOfferValue > 0 && ($estimatedDoge === null || $estimatedDoge < $refusedOfferValue)) {
        $estimatedDoge = $refusedOfferValue;
    }

    $listingAnalysis = null;
    $askingPrice = ($search && !empty($search['isListed']))
        ? normalizeNumber(isset($search['price']) ? $search['price'] : null)
        : null;
    if ($askingPrice !== null && $estimatedDoge !== null && $estimatedDoge > 0) {
        $diffDoge = $askingPrice - $estimatedDoge;
        $diffPercent = round(($diffDoge / $estimatedDoge) * 100, 1);
        $listingAnalysis = array(
            'askingPriceDoge' => $askingPrice,
            'estimatedDoge' => $estimatedDoge,
            'diffDoge' => $diffDoge,
            'diffPercent' => $diffPercent,
            'verdict' => $diffPercent < -10 ? 'undervalued' : ($diffPercent > 15 ? 'overpriced' : 'fair')
        );
    }

    $displayEstimatedUsd = ($displayOverride && isset($displayOverride['estimation']['displayEstimatedUsd']))
        ? $displayOverride['estimation']['displayEstimatedUsd']
        : null;
    $displayEstimatedDoge = ($displayEstimatedUsd !== null && $dogeUsd !== null && $dogeUsd > 0)
        ? intval(round($displayEstimatedUsd / $dogeUsd))
        : null;

    return array(
        'dogNumber' => $dogNumber,
        'communityLore' => $communityLore,
        'name' => ($search && !empty($search['name'])) ? $search['name'] : ('Doginal Dog #' . $dogNumber),
        'inscriptionId' => $search && !empty($search['inscriptionId']) ? $search['inscriptionId'] : null,
        'imageUrl' => '/api/doginal-proxy.php?action=image&dogNumber=' . $dogNumber,
        'isListed' => $search ? !empty($search['isListed']) : false,
        'rarityRank' => $rank,
        'rarityLabel' => rarityLabel($rank),
        'rarityMultiplier' => $rarityMultiplier,
        'traits' => array(
            'background' => isset($traits['background']) ? $traits['background'] : null,
            'furColor' => isset($traits['furColor']) ? $traits['furColor'] : null,
            'furPattern' => isset($traits['furPattern']) ? $traits['furPattern'] : null,
            'head' => isset($traits['head']) ? $traits['head'] : null,
            'eyes' => isset($traits['eyes']) ? $traits['eyes'] : null,
            'clothes' => isset($traits['clothes']) ? $traits['clothes'] : null,
            'mouth' => isset($traits['mouth']) ? $traits['mouth'] : null,
            'accessory' => isset($traits['accessory']) ? $traits['accessory'] : null,
        ),
        'traitBreakdown' => $traitBreakdown,
        'estimation' => array(
            'estimatedDoge' => $estimatedDoge,
            'estimatedUsd' => ($estimatedDoge !== null && $dogeUsd !== null) ? round($estimatedDoge * $dogeUsd, 2) : null,
            'displayEstimatedDoge' => $displayEstimatedDoge,
            'displayEstimatedUsd' => $displayEstimatedUsd,
            'displayEstimatedUsdNote' => ($displayOverride && isset($displayOverride['estimation']['displayEstimatedUsdNote'])) ? $displayOverride['estimation']['displayEstimatedUsdNote'] : null,
            'valueMultiplier' => $valueMultiplier !== 1.0 ? $valueMultiplier : null,
            'basePriceDoge' => $basePriceDoge !== null ? intval(round($basePriceDoge)) : null,
            'rarestTraitThinMarketBoost' => $rarestTraitThinMarketBoost,
            'traitBonus' => $traitBonus > 0 ? intval(round($traitBonus)) : 0,
            'rarestTrait' => $rarestTrait ? array('trait' => $rarestTrait['trait'], 'value' => $rarestTrait['value'], 'count' => $rarestTrait['traitCount']) : null,
            'compoundAnchor' => (isset($compoundResult['compoundRows']) && count($compoundResult['compoundRows']) > 0) ? array(
                'maxTraits' => isset($compoundResult['maxTraits']) ? intval($compoundResult['maxTraits']) : 3,
                'maxSupply' => isset($compoundResult['maxSupply']) ? intval($compoundResult['maxSupply']) : 2500,
                'traits' => $compoundResult['compoundRows'],
                'winningTrait' => (isset($compoundResult['winningTrait']) && $compoundResult['winningTrait']) ? array(
                    'trait' => $compoundResult['winningTrait']['trait'],
                    'value' => $compoundResult['winningTrait']['value'],
                    'count' => $compoundResult['winningTrait']['traitCount'],
                ) : null,
            ) : null,
            'trendingMultiplier' => $trendingMultiplier > 1 ? $trendingMultiplier : null,
            'trendingHits' => count($trendingHits) > 0 ? $trendingHits : null,
            'colorMatch' => $colorMatch,
            'colorMatchMultiplier' => $colorMatch !== null ? $colorMatchMultiplier : null,
            'minimalDog' => $isMinimalDog ? array('type' => $minimalType, 'label' => $minimalLabel, 'extraTraitCount' => $extraTraitCount) : null,
            'minimalMultiplier' => $isMinimalDog ? $minimalMultiplier : null,
            'ownTopSale' => $ownTopSale,
            'refusedOfferFloor' => $refusedOfferFloor !== null ? array(
                'dogNumber' => isset($refusedOfferFloor['dogNumber']) ? intval($refusedOfferFloor['dogNumber']) : $dogNumber,
                'minOfferDoge' => $refusedOfferValue,
                'minOfferUsd' => (isset($refusedOfferFloor['minOfferUsd']) && $refusedOfferFloor['minOfferUsd'] !== null)
                    ? round(floatval($refusedOfferFloor['minOfferUsd']), 2)
                    : (($refusedOfferValue !== null && $dogeUsd !== null) ? round(floatval($refusedOfferValue) * $dogeUsd, 2) : null),
                'note' => isset($refusedOfferFloor['note']) ? $refusedOfferFloor['note'] : null,
                'updatedAt' => isset($refusedOfferFloor['updatedAt']) ? $refusedOfferFloor['updatedAt'] : null,
                'updatedBy' => isset($refusedOfferFloor['updatedBy']) ? $refusedOfferFloor['updatedBy'] : null,
            ) : null,
            'collectionFloor' => $collectionFloor,
            'dogeUsd' => $dogeUsd,
            'communityLore' => $communityLore,
            'comboMatch' => $matchedCombo !== null ? array(
                'id' => isset($matchedCombo['id']) ? strval($matchedCombo['id']) : null,
                'label' => isset($matchedCombo['label']) ? strval($matchedCombo['label']) : null,
                'multiplier' => $comboMultiplier,
                'inscriptionIds' => ($search && !empty($search['inscriptionId'])) ? array(strval($search['inscriptionId'])) : array(),
                'dogNumber' => $dogNumber,
            ) : null,
            'comboMultiplier' => $matchedCombo !== null ? $comboMultiplier : null,
            'angelNumber' => $isAngelNumber ? array('type' => $angelType, 'label' => $angelLabel) : null,
            'angelMultiplier' => $isAngelNumber ? $angelMultiplier : null,
            'specialMultiplier' => count($specialMultiplierDetails) > 0 ? array_reduce($specialMultiplierDetails, function($acc, $detail) { return $acc * $detail['multiplier']; }, 1.0) : null,
            'specialMultiplierDetails' => count($specialMultiplierDetails) > 0 ? $specialMultiplierDetails : null,
            'method' => implode(' + ', array_filter(array(
                'compound_rarest_trait_anchor + trait_bonus + rarity_multiplier',
                $valueMultiplier !== 1.0 ? 'one_of_one_multiplier' : null,
                $colorMatch !== null ? 'color_match_multiplier' : null,
                $isMinimalDog ? 'minimal_dog_multiplier' : null,
                $matchedCombo !== null ? 'combo_multiplier' : null,
                $isAngelNumber ? 'angel_number_multiplier' : null,
                '(php_proxy)',
            ))),
        ),
        'listingAnalysis' => $listingAnalysis,
        'evaluatedAt' => gmdate('c')
    );
}

if ($action === 'community-status') {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        sendError('Method not allowed.', 405);
    }

    sendJson(array(
        'communityPasswordRequired' => getExpectedCommunityPassword() !== '',
    ));
}

if ($action === 'community-lore') {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        sendError('Method not allowed.', 405);
    }

    $dogNumber = validateDogNumber(isset($_GET['dogNumber']) ? $_GET['dogNumber'] : null);
    $notesStore = readCommunityNotesStorePhp();
    $nmap = isset($notesStore['notes']) && is_array($notesStore['notes']) ? $notesStore['notes'] : array();
    $lore = lookupCommunityLoreInNotesMapPhp($nmap, $dogNumber);
    sendJson(array(
        'dogNumber' => $dogNumber,
        'communityLore' => $lore,
    ), 200, 0);
}

if ($action === 'community-suggestions') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    $remoteIp = isset($_SERVER['REMOTE_ADDR']) ? strval($_SERVER['REMOTE_ADDR']) : 'unknown';
    if (ddCommunitySuggestionsRateLimited($remoteIp)) {
        sendError('Too many submissions. Try again later.', 429);
    }

    $expectedComm = getExpectedCommunityPassword();
    $rawBody = getJsonRequestBody();
    $headerComm = trim(strval(getRequestHeader('x-dd-community-password')));
    $bodyComm = isset($rawBody['communityPassword']) ? trim(strval($rawBody['communityPassword'])) : '';
    $provided = $headerComm !== '' ? $headerComm : $bodyComm;

    $bodyCopy = $rawBody;
    unset($bodyCopy['communityPassword']);

    if ($expectedComm !== '') {
        if ($provided === '' || !hash_equals($expectedComm, $provided)) {
            sendError('Invalid community password.', 401);
        }
    }

    $kind = isset($bodyCopy['kind']) ? $bodyCopy['kind'] : '';

    try {
        $payload = validateSuggestionPayloadPhp($kind, $bodyCopy);
    } catch (Exception $e) {
        sendError($e->getMessage() !== '' ? $e->getMessage() : 'Invalid suggestion payload.', 400);
    }

    $store = readSuggestionsStorePhp();
    $record = array(
        'id' => ddSuggestionUuid(),
        'status' => 'pending',
        'kind' => trim(strval($kind)),
        'payload' => $payload,
        'submittedAt' => gmdate('c'),
    );
    $store['items'][] = $record;

    try {
        writeSuggestionsStorePhp($store);
    } catch (Exception $e) {
        sendError('Could not save suggestion.', 500);
    }

    sendJson(array('ok' => true, 'id' => $record['id']), 201);
}

if ($action === 'snapshot_status') {
    sendJson(array(
        'ready' => true,
        'mode' => 'php_on_demand',
        'upstream' => 'market.doginaldogs.com',
        'evaluatesVia' => '/api/dd-evaluator.php?action=evaluate&dogNumber=7742'
    ), 200, 30);
}

if ($action === 'market-pulse') {
    try {
        $offersLimit = isset($_GET['offers']) ? intval($_GET['offers']) : 6;
        $salesLimit = isset($_GET['sales']) ? intval($_GET['sales']) : 6;
        $result = getMarketPulsePayload($offersLimit, $salesLimit);
        sendJson($result, 200, 300);
    } catch (Exception $e) {
        sendError('Market pulse failed: ' . $e->getMessage(), 502);
    }
}

if ($action === 'admin-trending') {
    if ($_SERVER['REQUEST_METHOD'] === 'GET') {
        try {
            $dashboard = getTrendingDashboardData();
            $dashboard['saveEnabled'] = getExpectedDdAdminPassword() !== '';
            sendJson($dashboard, 200, 30);
        } catch (Exception $e) {
            sendError('Trending dashboard failed: ' . $e->getMessage(), 500);
        }
    }

    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    requireDdAdminPassword();
    $body = getJsonRequestBody();

    try {
        $config = updateTrendingConfigData(array(
            'manualMultipliers' => isset($body['manualMultipliers']) && is_array($body['manualMultipliers']) ? $body['manualMultipliers'] : array(),
            'refusedOffers' => isset($body['refusedOffers']) && is_array($body['refusedOffers']) ? $body['refusedOffers'] : array(),
            'autoTrend' => isset($body['autoTrend']) && is_array($body['autoTrend']) ? $body['autoTrend'] : array(),
            'specialMultipliers' => isset($body['specialMultipliers']) && is_array($body['specialMultipliers']) ? $body['specialMultipliers'] : null,
            'updatedBy' => isset($body['updatedBy']) ? $body['updatedBy'] : 'admin-panel',
        ));
        $dashboard = getTrendingDashboardData();
        sendJson(array(
            'ok' => true,
            'config' => $config,
            'dashboard' => $dashboard,
            'saveEnabled' => true,
        ));
    } catch (Exception $e) {
        sendError('Trending update failed: ' . $e->getMessage(), 500);
    }
}

if ($action === 'admin-evaluations-import') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    requireDdAdminPassword();
    $body = getJsonRequestBody();
    $rawText = isset($body['rawText']) ? strval($body['rawText']) : '';
    $lookbackHours = max(1, min(168, intval(isset($body['lookbackHours']) ? $body['lookbackHours'] : $DD_IMPORT_LOOKBACK_HOURS)));
    $source = trim(strval(isset($body['source']) ? $body['source'] : 'kushmedia-backfill'));
    if ($source === '') {
        $source = 'kushmedia-backfill';
    }

    if (trim($rawText) === '') {
        sendError('Paste raw access logs, DD evaluator URLs, or NDJSON lines before importing.', 400);
    }

    try {
        $parsed = parseDdEvaluationImport($rawText, array('lookbackHours' => $lookbackHours));
        if (count($parsed['events']) === 0) {
            sendError('No DD evaluation requests were found in the pasted text. Supported patterns include /api/dd-evaluator/evaluate/269 and /api/dd-evaluator.php?action=evaluate&dogNumber=269.', 400);
        }

        $existingEntries = getEvaluationLog(array(
            'since' => gmdate('c', time() - ($lookbackHours * 3600)),
            'limit' => 5000,
        ));
        $existingKeys = array();
        foreach ($existingEntries as $entry) {
            $existingKeys[$entry['dogNumber'] . '|' . $entry['evaluatedAt']] = true;
        }

        $seenKeys = array();
        $pendingEvents = array();
        $duplicateCount = 0;
        foreach ($parsed['events'] as $event) {
            $dedupeKey = $event['dogNumber'] . '|' . $event['evaluatedAt'];
            if (isset($existingKeys[$dedupeKey]) || isset($seenKeys[$dedupeKey])) {
                $duplicateCount += 1;
                continue;
            }

            $seenKeys[$dedupeKey] = true;
            $pendingEvents[] = $event;
        }

        $uniqueDogNumbers = array();
        foreach ($pendingEvents as $event) {
            $dogNumber = intval($event['dogNumber']);
            if (!isset($uniqueDogNumbers[$dogNumber])) {
                $uniqueDogNumbers[$dogNumber] = $dogNumber;
            }
        }

        $evaluationByDog = array();
        foreach ($uniqueDogNumbers as $dogNumber) {
            try {
                $evaluationByDog[$dogNumber] = evaluateDog($dogNumber);
            } catch (Exception $e) {
                $evaluationByDog[$dogNumber] = array('error' => $e->getMessage());
            }
        }

        $failedDogs = array();
        $importedCount = 0;
        foreach ($pendingEvents as $event) {
            $dogNumber = intval($event['dogNumber']);
            $result = isset($evaluationByDog[$dogNumber]) ? $evaluationByDog[$dogNumber] : null;
            if (!is_array($result) || isset($result['error'])) {
                if (!in_array($dogNumber, $failedDogs, true)) {
                    $failedDogs[] = $dogNumber;
                }
                continue;
            }

            appendEvaluationLogEntry($result, $source, array('evaluatedAt' => $event['evaluatedAt']));
            $importedCount += 1;
        }

        $dashboard = getTrendingDashboardData();
        sendJson(array(
            'ok' => true,
            'importedCount' => $importedCount,
            'matchedCount' => count($parsed['events']),
            'duplicateCount' => $duplicateCount,
            'invalidCount' => $parsed['invalidCount'],
            'skippedOutsideWindow' => $parsed['skippedOutsideWindow'],
            'uniqueDogs' => count($uniqueDogNumbers),
            'failedDogs' => $failedDogs,
            'lookbackHours' => $lookbackHours,
            'dashboard' => $dashboard,
            'saveEnabled' => true,
        ));
    } catch (Exception $e) {
        sendError('Evaluation import failed: ' . $e->getMessage(), 500);
    }
}

if ($action === 'admin-evaluations-clear') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    requireDdAdminPassword();
    $body = getJsonRequestBody();
    $source = trim(strval(isset($body['source']) ? $body['source'] : 'kushmedia-backfill'));
    if ($source === '') {
        $source = 'kushmedia-backfill';
    }

    try {
        $cleared = clearEvaluationLogEntries(array('source' => $source));
        $dashboard = getTrendingDashboardData();
        sendJson(array(
            'ok' => true,
            'removedCount' => $cleared['removedCount'],
            'remainingCount' => $cleared['remainingCount'],
            'source' => $cleared['source'],
            'dashboard' => $dashboard,
            'saveEnabled' => true,
        ));
    } catch (Exception $e) {
        sendError('Evaluation clear failed: ' . $e->getMessage(), 500);
    }
}

if ($action === 'rank-lookup') {
    $rank = isset($_GET['rank']) ? intval($_GET['rank']) : 0;
    if ($rank < 1 || $rank > 10000) {
        sendError('Invalid rank. Must be 1–10000.');
    }

    // Read the pre-built rank→dogNumber map
    $mapPath = __DIR__ . '/data/rank-map.json';
    if (!file_exists($mapPath)) {
        sendError('Rank map not built yet. Run the build-rank-map script first.', 503);
    }

    $map = json_decode(file_get_contents($mapPath), true);
    if (!is_array($map)) {
        sendError('Rank map file is corrupt.', 500);
    }

    $rankStr = strval($rank);
    if (isset($map[$rankStr])) {
        sendJson(array('rank' => $rank, 'dogNumber' => intval($map[$rankStr]), 'source' => 'rank-map'), 200, 3600);
    }

    sendError('No dog found with rarity rank ' . $rank . '. The rank map covers ' . count($map) . ' dogs.', 404);
}

if ($action === 'admin-community-notes-list') {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        sendError('Method not allowed.', 405);
    }

    assertDdAdminApiPasswordOr401();

    $ns = readCommunityNotesStorePhp();
    $notes = isset($ns['notes']) && is_array($ns['notes']) ? $ns['notes'] : array();
    $entries = array();
    foreach ($notes as $k => $v) {
        $loreStr = normalizeCommunityLoreNoteValuePhp($v);
        if ($loreStr === '') {
            continue;
        }
        $ks = trim(strval($k));
        if ($ks === '' || !ctype_digit($ks)) {
            continue;
        }
        $dn = intval($ks);
        if ($dn < 1 || $dn > 10000) {
            continue;
        }
        $entries[] = array('dogNumber' => $dn, 'lore' => $loreStr);
    }
    usort($entries, function ($left, $right) {
        return intval($left['dogNumber']) - intval($right['dogNumber']);
    });

    sendJson(array(
        'entries' => $entries,
        'count' => count($entries),
    ), 200, 0);
}

if ($action === 'admin-community-notes-save') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    assertDdAdminApiPasswordOr401();
    $rawBody = getJsonRequestBody();
    $dogNumber = validateDogNumber(isset($rawBody['dogNumber']) ? $rawBody['dogNumber'] : null);
    $lore = isset($rawBody['lore']) ? trim(strval($rawBody['lore'])) : '';
    if ($lore === '') {
        sendError('lore is required.', 400);
    }
    if (strlen($lore) > 8000) {
        sendError('lore is too long (max 8000 characters).', 400);
    }

    $ns = readCommunityNotesStorePhp();
    $notes = isset($ns['notes']) && is_array($ns['notes']) ? $ns['notes'] : array();
    foreach (array_keys($notes) as $k) {
        if (intval($k) === intval($dogNumber) || strval($k) === strval($dogNumber)) {
            unset($notes[$k]);
        }
    }
    $notes[strval($dogNumber)] = $lore;
    $ns['notes'] = $notes;
    try {
        writeCommunityNotesStorePhp($ns);
    } catch (Exception $e) {
        sendError('Could not save community notes.', 500);
    }

    sendJson(array(
        'ok' => true,
        'dogNumber' => $dogNumber,
        'communityNotesDogCount' => communityNotesDogCountPhp(),
    ), 200, 0);
}

if ($action === 'admin-community-notes-delete') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    assertDdAdminApiPasswordOr401();
    $rawBody = getJsonRequestBody();
    $dogNumber = validateDogNumber(isset($rawBody['dogNumber']) ? $rawBody['dogNumber'] : null);

    $ns = readCommunityNotesStorePhp();
    $notes = isset($ns['notes']) && is_array($ns['notes']) ? $ns['notes'] : array();
    $removed = false;
    foreach (array_keys($notes) as $k) {
        if (intval($k) === intval($dogNumber) || strval($k) === strval($dogNumber)) {
            unset($notes[$k]);
            $removed = true;
        }
    }
    $ns['notes'] = $notes;
    try {
        writeCommunityNotesStorePhp($ns);
    } catch (Exception $e) {
        sendError('Could not save community notes.', 500);
    }

    sendJson(array(
        'ok' => true,
        'dogNumber' => $dogNumber,
        'removed' => $removed,
        'communityNotesDogCount' => communityNotesDogCountPhp(),
    ), 200, 0);
}

if ($action === 'admin-suggestions') {
    if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
        sendError('Method not allowed.', 405);
    }

    assertDdAdminApiPasswordOr401();

    $statusFilter = strtolower(trim(strval(isset($_GET['status']) ? $_GET['status'] : '')));
    $store = readSuggestionsStorePhp();
    $items = isset($store['items']) && is_array($store['items']) ? $store['items'] : array();
    if ($statusFilter === 'pending' || $statusFilter === 'approved' || $statusFilter === 'rejected') {
        $filtered = array();
        foreach ($items as $it) {
            if (is_array($it) && isset($it['status']) && strval($it['status']) === $statusFilter) {
                $filtered[] = $it;
            }
        }
        $items = $filtered;
    }

    sendJson(array(
        'items' => $items,
        'communityNotesDogCount' => communityNotesDogCountPhp(),
    ));
}

if ($action === 'admin-suggestions-review') {
    if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
        sendError('Method not allowed.', 405);
    }

    assertDdAdminApiPasswordOr401();

    $suggestionId = isset($_GET['suggestionId']) ? trim(strval($_GET['suggestionId'])) : '';
    $rawBody = getJsonRequestBody();
    $reviewVerb = isset($rawBody['action']) ? strtolower(trim(strval($rawBody['action']))) : '';
    $note = isset($rawBody['note']) ? trim(strval($rawBody['note'])) : '';

    if ($suggestionId === '') {
        sendError('Missing suggestion id.', 400);
    }
    if ($reviewVerb !== 'approve' && $reviewVerb !== 'reject') {
        sendError('action must be approve or reject.', 400);
    }

    $store = readSuggestionsStorePhp();
    $items = isset($store['items']) && is_array($store['items']) ? $store['items'] : array();
    $idx = -1;
    foreach ($items as $i => $it) {
        if (is_array($it) && isset($it['id']) && strval($it['id']) === $suggestionId) {
            $idx = intval($i);
            break;
        }
    }

    if ($idx < 0) {
        sendError('Suggestion not found.', 404);
    }

    $item = $items[$idx];
    $st = isset($item['status']) ? strval($item['status']) : '';
    if ($st !== 'pending') {
        sendError('Suggestion is not pending.', 400);
    }

    $reviewedAt = gmdate('c');

    if ($reviewVerb === 'reject') {
        $item['status'] = 'rejected';
        $item['reviewedAt'] = $reviewedAt;
        $item['reviewNote'] = $note !== '' ? $note : null;
        $items[$idx] = $item;
        $store['items'] = $items;
        try {
            writeSuggestionsStorePhp($store);
        } catch (Exception $e) {
            sendError('Could not save.', 500);
        }
        sendJson(array('ok' => true, 'suggestion' => $item));
    }

    try {
        $mergeResult = mergeApprovedSuggestionPhp($item);
        $item['status'] = 'approved';
        $item['reviewedAt'] = $reviewedAt;
        $item['reviewNote'] = $note !== '' ? $note : null;
        $item['mergeResult'] = $mergeResult;
        $items[$idx] = $item;
        $store['items'] = $items;
        writeSuggestionsStorePhp($store);
        sendJson(array('ok' => true, 'suggestion' => $item));
    } catch (Exception $e) {
        sendError('Approve suggestion merge failed: ' . $e->getMessage(), 500);
    }
}

if ($action === 'evaluate') {
    $qm = isset($_GET['quotaMode']) ? strtolower(trim(strval($_GET['quotaMode']))) : 'inscription';
    $rarityMode = ($qm === 'rarity');
    $cap = $rarityMode ? dd_paywall_free_rarity_cap() : dd_paywall_free_inscriptions_cap();
    dd_paywall_quota_try_consume($rarityMode ? 'rarity' : 'inscribe', $cap);
    try {
        $dogNumber = validateDogNumber(isset($_GET['dogNumber']) ? $_GET['dogNumber'] : null);
        $result = evaluateDog($dogNumber);
        sendJson($result, 200, 0);
    } catch (Exception $e) {
        sendError('Evaluation failed: ' . $e->getMessage(), 502);
    }
}

if ($action === 'wallet') {
    sendJson(array(
        'code' => 'dd_wallet_plus_only',
        'error' => 'Wallet portfolio valuations are exclusive to KushMetaX Doginal Dogs Plus subscribers.',
    ), 403, 0);
}

sendError('Unknown action. Use evaluate, wallet, market-pulse, rank-lookup, snapshot_status, community-status, community-lore, community-suggestions, or admin routes.');