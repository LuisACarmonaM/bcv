<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\Api\BcvController; // <-- Importante añadir esta línea

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');

// Tu nueva ruta para el BCV
Route::get('/tasas-bcv', [BcvController::class, 'getRates']);
