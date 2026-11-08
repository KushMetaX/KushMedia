<?php
// Copy this file OUTSIDE your web root, e.g. /home/<cpanel-user>/oracle-madness-config.php
// (one level above public_html). proxy.php looks there by default. Never commit the real one.
return [
    // Free key: https://pythdata.app/signup  (sent as "Authorization: Bearer <key>")
    'pyth_api_key'    => '',
    'hermes_base'     => 'https://hermes.pyth.network',
    'benchmarks_base' => 'https://benchmarks.pyth.network',
    // Every visitor polls ~1/s; a 1 s file cache means Hermes sees at most ~1 req/s total.
    'cache_seconds'   => 1,
    // Only needed if the page is served from a different origin than proxy.php.
    'allowed_origins' => [],
];
