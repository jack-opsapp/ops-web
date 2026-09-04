<?php
declare(strict_types=1);

$baseUrl = getenv('OPS_API_BASE_URL') ?: 'https://app.opsapp.co';
$credential = getenv('OPS_INTAKE_CREDENTIAL');
if (!$credential) {
    throw new RuntimeException('OPS_INTAKE_CREDENTIAL is required');
}

function opsRequest(
    string $method,
    string $path,
    string $credential,
    ?array $payload = null,
    ?string $idempotencyKey = null
): array {
    global $baseUrl;
    $headers = [
        'Accept: application/json',
        'Authorization: Bearer ' . $credential,
    ];
    if ($payload !== null) {
        $headers[] = 'Content-Type: application/json';
    }
    if ($idempotencyKey !== null) {
        $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
    }

    $handle = curl_init($baseUrl . $path);
    curl_setopt_array($handle, [
        CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POSTFIELDS => $payload === null
            ? null
            : json_encode($payload, JSON_THROW_ON_ERROR),
    ]);
    $raw = curl_exec($handle);
    $status = curl_getinfo($handle, CURLINFO_RESPONSE_CODE);
    curl_close($handle);
    if (!is_string($raw)) {
        throw new RuntimeException('OPS request failed');
    }
    $body = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);
    if ($status < 200 || $status >= 300) {
        throw new RuntimeException(
            'OPS request failed: ' . ($body['error']['code'] ?? $status)
        );
    }
    return $body['result'];
}

$config = opsRequest('GET', '/v1/intake/config', $credential);
$source = $config['sources'][0];
$submission = opsRequest(
    'POST',
    '/v1/intake/submissions',
    $credential,
    [
        'sourceId' => $source['sourceId'],
        'formId' => $source['forms'][0]['formId'],
        'contact' => [
            'name' => 'Sample customer',
            'email' => 'customer@example.com',
        ],
        'workSummary' => 'Replace the rear deck.',
        'answers' => [],
        'uploadIds' => [],
        'externalSubmissionId' => 'website-form-0001',
    ],
    'submission-website-form-0001'
);

// Keep this file server-side. Never expose $credential to browser code.
