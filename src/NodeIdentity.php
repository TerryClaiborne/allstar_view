<?php
declare(strict_types=1);

namespace AllStarView;

final class NodeIdentity
{
    public static function echoLinkNodeNumber(string $value, bool $mappedOnly = false): string
    {
        $value = trim($value);
        if (preg_match('/^3(\d{6})$/', $value, $match) === 1) {
            return ltrim($match[1], '0') ?: '0';
        }
        return !$mappedOnly && preg_match('/^\d{1,6}$/', $value) === 1
            ? (ltrim($value, '0') ?: '0')
            : '';
    }

    public static function webPhoneCallsign(string $value): string
    {
        $value = strtoupper(trim($value));
        $value = str_ends_with($value, '-P') ? substr($value, 0, -2) : $value;
        return preg_match('/^[A-Z]{1,3}[0-9][A-Z0-9]{1,4}$/', $value) === 1 ? $value : '';
    }

    public static function qrzCallsign(string $value): string
    {
        return preg_match('/\b([A-Z]{1,3}[0-9][A-Z0-9]{1,4})\b/', strtoupper(trim($value)), $match) === 1
            ? $match[1]
            : '';
    }

    public static function astdbLookup(string $node): ?array
    {
        static $records = null;
        if ($records === null) {
            $records = [];
            foreach ([
                '/var/lib/asterisk/astdb.txt',
                '/var/www/html/allscan/astdb.txt',
                '/var/www/html/supermon/astdb.txt',
            ] as $path) {
                $handle = @fopen($path, 'r');
                if ($handle === false) {
                    continue;
                }
                while (($line = fgets($handle)) !== false) {
                    $parts = explode('|', trim($line));
                    $entryNode = trim((string) ($parts[0] ?? ''));
                    if ($entryNode === '') {
                        continue;
                    }
                    $records[$entryNode] = [
                        'call' => self::cleanDisplay((string) ($parts[1] ?? '')),
                        'description' => self::cleanDisplay((string) ($parts[2] ?? '')),
                        'location' => self::cleanDisplay((string) ($parts[3] ?? '')),
                    ];
                }
                fclose($handle);
                break;
            }
        }
        return $records[$node] ?? null;
    }

    public static function cleanDisplay(string $value): string
    {
        $value = trim(preg_replace('/\s+/', ' ', $value) ?? '');
        return in_array($value, ['-', '--'], true) ? '' : $value;
    }
}
