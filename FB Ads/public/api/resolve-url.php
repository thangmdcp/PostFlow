<?php
header('Content-Type: application/json; charset=utf-8');

$rawUrl = $_GET['url'] ?? '';
$parts = parse_url($rawUrl);
$host = strtolower($parts['host'] ?? '');
$scheme = strtolower($parts['scheme'] ?? '');
$allowedHosts = ['s.shopee.vn', 'shopee.vn', 'www.shopee.vn'];

if (!in_array($scheme, ['http', 'https'], true) || !in_array($host, $allowedHosts, true)) {
  http_response_code(400);
  echo json_encode(['error' => 'URL không được hỗ trợ.']);
  exit;
}

$finalUrl = $rawUrl;
$body = '';

if (function_exists('curl_init')) {
  $ch = curl_init($rawUrl);
  curl_setopt_array($ch, [
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_HEADER => false,
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_MAXREDIRS => 8,
    CURLOPT_CONNECTTIMEOUT => 3,
    CURLOPT_TIMEOUT => 6,
    CURLOPT_USERAGENT => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0 Safari/537.36',
    CURLOPT_HTTPHEADER => [
      'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language: vi,en-US;q=0.9,en;q=0.8',
    ],
  ]);
  $body = curl_exec($ch);
  $infoUrl = curl_getinfo($ch, CURLINFO_EFFECTIVE_URL);
  $status = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
  $error = curl_error($ch);
  curl_close($ch);

  if ($infoUrl) {
    $finalUrl = $infoUrl;
  } elseif ($error) {
    http_response_code(502);
    echo json_encode(['error' => $error]);
    exit;
  }
  if ($status >= 400 && $finalUrl === $rawUrl) {
    http_response_code(502);
    echo json_encode(['error' => 'Shopee không trả redirect hợp lệ.', 'status' => $status]);
    exit;
  }
} else {
  $headers = @get_headers($rawUrl, true);
  if ($headers === false) {
    http_response_code(502);
    echo json_encode(['error' => 'Không resolve được URL.']);
    exit;
  }
  if (!empty($headers['Location'])) {
    $location = is_array($headers['Location']) ? end($headers['Location']) : $headers['Location'];
    if ($location) $finalUrl = $location;
  }
}

if ($finalUrl === $rawUrl && is_string($body) && $body !== '') {
  if (preg_match('/https?:\/\/[^"\'<>\s]+utm_content=[^"\'<>\s]+/i', $body, $match)) {
    $finalUrl = html_entity_decode($match[0], ENT_QUOTES | ENT_HTML5, 'UTF-8');
  } elseif (preg_match('/<meta[^>]+http-equiv=["\']?refresh["\']?[^>]+content=["\'][^"\']*url=([^"\']+)["\']/i', $body, $match)) {
    $finalUrl = html_entity_decode($match[1], ENT_QUOTES | ENT_HTML5, 'UTF-8');
  }
}

echo json_encode(['url' => $finalUrl]);
