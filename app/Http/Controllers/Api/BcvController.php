<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use Illuminate\Http\JsonResponse;
use GuzzleHttp\Client;
use Symfony\Component\DomCrawler\Crawler;
use Illuminate\Support\Facades\Cache;

class BcvController extends Controller
{
    public function getRates(): JsonResponse
    {
        // Caché de 1 hora para evitar bloqueos del servidor del BCV
        return Cache::remember('bcv_rates', 3600, function () {

            // Desactivamos la verificación SSL por si el certificado del BCV presenta fallas
            $client = new Client([
                'verify'  => false,
                'timeout' => 15, // Evita que se quede colgado si el BCV está lento
                'headers' => [
                    'User-Agent'      => 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Accept'          => 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                    'Accept-Language' => 'es-ES,es;q=0.9,en;q=0.8',
                ]
            ]);

            try {
                $response = $client->request('GET', 'https://www.bcv.org.ve/');
                $html = (string) $response->getBody();

                $crawler = new Crawler($html);

                $data = [
                    'EUR' => $this->parseRate($crawler, '#euro strong'),
                    'CNY' => $this->parseRate($crawler, '#yuan strong'),
                    'TRY' => $this->parseRate($crawler, '#lira strong'),
                    'RUB' => $this->parseRate($crawler, '#rublo strong'),
                    'USD' => $this->parseRate($crawler, '#dolar strong'),
                    'fecha_valor' => $this->parseDate($crawler, '.date-display-single')
                ];

                return response()->json([
                    'success' => true,
                    'data'    => $data,
                ], 200);
            } catch (\Exception $e) {
                return response()->json([
                    'success' => false,
                    'message' => 'Error conectando con el BCV',
                    'error'   => $e->getMessage()
                ], 500);
            }
        });
    }

    private function parseRate(Crawler $crawler, string $selector): ?float
    {
        try {
            $text = $crawler->filter($selector)->text('');
            $clean = str_replace(',', '.', trim($text));
            return (float) preg_replace('/[^0-9.]/', '', $clean);
        } catch (\Exception $e) {
            return null;
        }
    }

    private function parseDate(Crawler $crawler, string $selector): ?string
    {
        try {
            return trim($crawler->filter($selector)->first()->text(''));
        } catch (\Exception $e) {
            return null;
        }
    }
}
