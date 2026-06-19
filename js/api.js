/**
 * api.js — Capa de conexión centralizada con webhooks n8n
 *
 * Todas las peticiones HTTP al servidor externo pasan por este módulo.
 * Esto permite cambiar URLs, headers o lógica de reintentos en un solo lugar
 * sin tocar la interfaz (app.js).
 */

// URL base del servidor n8n (configurable desde la consola del navegador)
const N8N_BASE_URL = localStorage.getItem('nexus_api_base') || 'http://34.123.160.45:5678/webhook';

/** Webhook principal del micrófono / sincronización n8n */
const N8N_MIC_WEBHOOK =
    'http://34.123.160.45:5678/webhook-test/d249770d-bec2-426f-98ac-35af544dfb5e';

/** Activa las peticiones reales cuando tu servidor n8n esté listo. */
export const API_ENABLED = localStorage.getItem('nexus_api_enabled') === 'true';

/**
 * Endpoints de cada integración del ecosistema.
 * Cada clave representa un flujo distinto en n8n.
 */
const ENDPOINTS = {
    morningSummary: `${N8N_BASE_URL}/saludo`,
    garminMetrics: `${N8N_BASE_URL}/garmin`,
    financeData: `${N8N_BASE_URL}/finanzas`,
    agendaEvents: `${N8N_BASE_URL}/agenda`,
    uciProgress: `${N8N_BASE_URL}/estudio`,
    fitnessRoutine: `${N8N_BASE_URL}/fitness`,
    correos: `${N8N_BASE_URL}/correos`,
    voiceCommand: N8N_MIC_WEBHOOK,
};

/**
 * Realiza una petición POST genérica al webhook de n8n.
 * Usamos POST porque n8n suele esperar un cuerpo JSON con parámetros.
 *
 * @param {string} url - URL completa del webhook
 * @param {object} payload - Datos a enviar en el cuerpo
 * @returns {Promise<object>} Respuesta parseada como JSON
 */
async function postToWebhook(url, payload = {}) {
    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
        },
        body: JSON.stringify(payload),
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Realiza una petición GET genérica al webhook de n8n.
 * Algunos flujos de n8n exponen datos de solo lectura vía GET.
 *
 * @param {string} url - URL completa del webhook
 * @returns {Promise<object>} Respuesta parseada como JSON
 */
async function getFromWebhook(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
}

/**
 * Obtiene el resumen matutino generado por Gemini vía n8n.
 * Este texto alimenta la tarjeta "Resumen IA" del dashboard.
 *
 * @returns {Promise<object|null>} Datos del resumen o null si falla
 */
export async function fetchMorningSummary() {
    try {
        const data = await getFromWebhook(ENDPOINTS.morningSummary);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener resumen matutino:', error.message);
        return null;
    }
}

/**
 * Obtiene métricas fisiológicas sincronizadas desde Garmin Connect.
 * Incluye Body Battery, horas de sueño y nivel de estrés.
 *
 * @returns {Promise<object|null>} Métricas de salud o null si falla
 */
export async function fetchGarminMetrics() {
    try {
        const data = await getFromWebhook(ENDPOINTS.garminMetrics);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener métricas Garmin:', error.message);
        return null;
    }
}

/**
 * Obtiene el estado financiero registrado por el bot de Telegram.
 * Devuelve presupuesto, gastos y últimos movimientos.
 *
 * @returns {Promise<object|null>} Datos financieros o null si falla
 */
export async function fetchFinanceData() {
    try {
        const data = await getFromWebhook(ENDPOINTS.financeData);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener datos financieros:', error.message);
        return null;
    }
}

/**
 * Obtiene eventos del calendario y contador de correos sin leer.
 *
 * @returns {Promise<object|null>} Agenda y correos o null si falla
 */
export async function fetchAgendaEvents() {
    try {
        const response = await fetch(ENDPOINTS.agendaEvents, {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const text = await response.text();
        if (!text || text.trim() === '') return [];
        return JSON.parse(text);
    } catch (error) {
        console.error('[API] Error al obtener agenda:', error.message);
        return null;
    }
}

/**
 * Obtiene el progreso de los módulos UCI y horas de estudio semanales.
 *
 * @returns {Promise<object|null>} Progreso académico o null si falla
 */
export async function fetchUciProgress() {
    try {
        const data = await getFromWebhook(ENDPOINTS.uciProgress);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener progreso UCI:', error.message);
        return null;
    }
}

/**
 * Obtiene la rutina de entrenamiento programada para el día actual.
 *
 * @returns {Promise<object|null>} Rutina fitness o null si falla
 */
export async function fetchCorreos() {
    try {
        const data = await getFromWebhook(ENDPOINTS.correos);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener correos:', error.message);
        return null;
    }
}

export async function fetchFitnessRoutine() {
    try {
        const data = await getFromWebhook(ENDPOINTS.fitnessRoutine);
        return data;
    } catch (error) {
        console.error('[API] Error al obtener rutina fitness:', error.message);
        return null;
    }
}

/**
 * Envía un comando de voz transcrito al webhook de n8n.
 * n8n procesará el texto con Gemini y ejecutará la acción correspondiente
 * (registrar gasto, consultar rutina, leer correos, etc.).
 *
 * @param {string} transcript - Texto reconocido por la Web Speech API
 * @returns {Promise<object|null>} Respuesta del servidor o null si falla
 */
export async function sendVoiceCommand(transcript) {
    if (!transcript || !transcript.trim()) {
        console.warn('[API] Comando de voz vacío, no se envía al servidor.');
        return null;
    }

    try {
        const data = await postToWebhook(ENDPOINTS.voiceCommand, {
            command: transcript.trim(),
            timestamp: new Date().toISOString(),
            source: 'nexus-dashboard',
        });
        return data;
    } catch (error) {
        console.error('[API] Error al enviar comando de voz:', error.message);
        return null;
    }
}

/**
 * Registra un gasto manualmente vía webhook (útil para pruebas sin voz).
 *
 * @param {string} description - Descripción del gasto
 * @param {number} amount - Monto en pesos chilenos
 * @param {string} category - Categoría opcional
 * @returns {Promise<object|null>} Confirmación o null si falla
 */
export async function registerExpense(description, amount, category = 'general') {
    try {
        const data = await postToWebhook(ENDPOINTS.financeData, {
            action: 'register_expense',
            description,
            amount,
            category,
        });
        return data;
    } catch (error) {
        console.error('[API] Error al registrar gasto:', error.message);
        return null;
    }
}
