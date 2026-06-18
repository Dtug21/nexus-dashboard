/**
 * app.js — Lógica principal del Dashboard (Frontend-First)
 *
 * Usa mockData local por defecto. Si activas la API (localStorage nexus_api_enabled=true),
 * intentará cargar datos reales desde n8n y caerá al mock si falla.
 */

import {
    API_ENABLED,
    fetchMorningSummary,
    fetchGarminMetrics,
    fetchFinanceData,
    fetchAgendaEvents,
    fetchUciProgress,
    fetchFitnessRoutine,
    sendVoiceCommand,
} from './api.js';

/* ==========================================================================
   mockData — Datos de prueba para visualizar el diseño sin backend
   ========================================================================== */
const mockData = {
    saludo:
        'Buenos días. Recuperación fisiológica óptima al 88%. Hoy tienes turno clínico y sesión de estudio programada. Tu presupuesto semanal está bajo control.',

    garmin: {
        bodyBattery: 88,
        sueno: '7h 30m',
    },

    finanzas: {
        presupuesto: 100000,
        gastado: 35000,
    },

    estudio: {
        activo: 0,
        temas: [
            { modulo: 'Manejo Avanzado de TQT y CVC', progreso: 75 },
            { modulo: 'Fisiopatología Respiratoria', progreso: 42 },
        ],
    },

    habitos: {
        terapia: 'Exposición al frío - 3 min',
        ejercicio: 'Fuerza - Tren Superior',
    },

    busquedaProfesional: {
        postulacionesSemana: 12,
        entrevistasPendientes: 2,
        estado: 'Activo',
    },

    // Datos extra de agenda para completar la tarjeta de productividad
    agenda: {
        correos: 6,
        eventos: [
            { titulo: 'Ronda UCI — Turno mañana', hora: '08:00 — 12:00', destacado: true },
            { titulo: 'Sesión estudio clínico', hora: '15:00 — 16:30', destacado: false },
            { titulo: 'Revisión bandeja de entrada', hora: '17:00 — 17:30', destacado: false },
        ],
    },
};

/* Referencia al gráfico de finanzas para futuras actualizaciones */
let financeChart = null;
let bodyBatteryChart = null;

const ESTUDIO_STORAGE_KEY = 'nexus-estudio';

/* Estado visual del micrófono y reconocimiento de voz */
let isMicActive = false;
let speechRecognition = null;
let closeMobileMenu = () => {};

/* ==========================================================================
   Utilidades
   ========================================================================== */

/**
 * Formatea montos en pesos chilenos para mostrarlos en la UI.
 */
function formatCLP(value) {
    return new Intl.NumberFormat('es-CL', {
        style: 'currency',
        currency: 'CLP',
        maximumFractionDigits: 0,
    }).format(value);
}

/**
 * Muestra la fecha actual en el encabezado del dashboard.
 */
function renderDate() {
    const now = new Date();
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const formatted = now.toLocaleDateString('es-ES', options);
    document.getElementById('dateDisplay').textContent =
        formatted.charAt(0).toUpperCase() + formatted.slice(1);
}

/* ==========================================================================
   Efectos de interfaz: typewriter y sonido de teclas
   ========================================================================== */

/* Audio precargado para el clic de tecla (reutilizamos cloneNode por velocidad) */
let keystrokeSample = null;
let typingAudioContext = null;

/**
 * Inicializa el contexto de audio Web API.
 * Algunos navegadores lo suspenden hasta que el usuario interactúa con la página.
 */
function initTypingAudioContext() {
    if (!typingAudioContext) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return null;
        typingAudioContext = new AudioCtx();
    }
    if (typingAudioContext.state === 'suspended') {
        typingAudioContext.resume();
    }
    return typingAudioContext;
}

/**
 * Genera un clic mecánico sintético cuando no hay archivo de audio disponible.
 * Simula el golpe corto de una tecla de máquina de escribir.
 */
function playSyntheticKeystroke() {
    try {
        const ctx = initTypingAudioContext();
        if (!ctx) return;

        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();
        const filter = ctx.createBiquadFilter();

        oscillator.type = 'square';
        oscillator.frequency.value = 700 + Math.random() * 350;

        filter.type = 'highpass';
        filter.frequency.value = 500;

        const volume = 0.04 + Math.random() * 0.03;
        gainNode.gain.setValueAtTime(volume, ctx.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);

        oscillator.connect(filter);
        filter.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 0.045);
    } catch (error) {
        console.warn('[Keystroke] No se pudo generar sonido sintético:', error.message);
    }
}

/**
 * Reproduce el sonido de una tecla al escribir cada carácter.
 *
 * Coloca un archivo corto de clic de teclado en assets/keystroke.mp3
 * (también puedes usar beep.mp3 renombrado). Si no existe, usa sonido sintético.
 */
function playKeystrokeSound() {
    try {
        if (!keystrokeSample) {
            keystrokeSample = new Audio('assets/keystroke.mp3');
            keystrokeSample.load();
        }

        const click = keystrokeSample.cloneNode();
        click.volume = 0.12 + Math.random() * 0.1;
        click.playbackRate = 0.9 + Math.random() * 0.25;

        click.play().catch(() => {
            playSyntheticKeystroke();
        });
    } catch (error) {
        playSyntheticKeystroke();
    }
}

/**
 * Escribe un texto letra por letra en el DOM simulando una máquina de escribir.
 * Reproduce sonido de tecla en cada carácter visible (no en espacios).
 *
 * @param {string} text - Texto completo a mostrar
 * @param {string} elementId - ID del elemento HTML destino
 * @param {number} speed - Milisegundos entre cada carácter (default: 35)
 */
function typeWriterEffect(text, elementId, speed = 35) {
    const element = document.getElementById(elementId);
    if (!element) {
        console.warn(`[Typewriter] No se encontró el elemento #${elementId}`);
        return;
    }

    element.textContent = '';

    const cursor = document.createElement('span');
    cursor.className = 'typewriter-cursor';
    cursor.textContent = '|';
    cursor.setAttribute('aria-hidden', 'true');
    element.appendChild(cursor);

    let charIndex = 0;

    function typeNextChar() {
        if (charIndex < text.length) {
            const char = text.charAt(charIndex);
            cursor.insertAdjacentText('beforebegin', char);

            if (char !== ' ') {
                playKeystrokeSound();
            }

            charIndex += 1;
            setTimeout(typeNextChar, speed);
        } else {
            cursor.remove();
        }
    }

    typeNextChar();
}

/* ==========================================================================
   Renderizado de tarjetas desde mockData
   ========================================================================== */

/**
 * Inicia el saludo con efecto máquina de escribir y sonido de teclas.
 */
function renderSaludoAnimado() {
    typeWriterEffect(mockData.saludo, 'saludoText', 32);
}

/**
 * Pinta Body Battery y horas de sueño desde los datos Garmin mock.
 */
function renderRecuperacion() {
    const { bodyBattery, sueno } = mockData.garmin;

    document.getElementById('bodyBatteryValue').textContent = `${bodyBattery} / 100`;
    document.getElementById('suenoValue').textContent = sueno;
    initBodyBatteryWaveChart(bodyBattery);
}

/**
 * Gráfico de onda estilo HUD para Body Battery (como la referencia visual).
 */
function initBodyBatteryWaveChart(level) {
    const canvas = document.getElementById('bodyBatteryChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const wavePoints = [62, 68, 72, 78, 82, 85, 88, 86, 88, 90, 88, level];

    if (bodyBatteryChart) {
        bodyBatteryChart.destroy();
    }

    bodyBatteryChart = new Chart(ctx, {
        type: 'line',
        data: {
            labels: wavePoints.map((_, i) => i),
            datasets: [{
                data: wavePoints,
                borderColor: '#00f0ff',
                backgroundColor: (context) => {
                    const { chart } = context;
                    const { ctx: c, chartArea } = chart;
                    if (!chartArea) return 'rgba(0, 240, 255, 0.1)';
                    const gradient = c.createLinearGradient(0, chartArea.top, 0, chartArea.bottom);
                    gradient.addColorStop(0, 'rgba(0, 240, 255, 0.35)');
                    gradient.addColorStop(1, 'rgba(0, 240, 255, 0)');
                    return gradient;
                },
                borderWidth: 2.5,
                fill: true,
                tension: 0.45,
                pointRadius: 0,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { enabled: false } },
            scales: {
                x: { display: false },
                y: { display: false, min: 50, max: 100 },
            },
            animation: { duration: 1400 },
        },
    });
}

/**
 * Calcula el disponible y actualiza las pills de finanzas.
 */
function renderFinanzas() {
    const { presupuesto, gastado } = mockData.finanzas;
    const disponible = presupuesto - gastado;

    document.getElementById('gastadoValue').textContent = formatCLP(gastado);
    document.getElementById('disponibleValue').textContent = formatCLP(disponible);

    return { gastado, disponible };
}

/**
 * Crea gradientes orgánicos para el gráfico doughnut de finanzas.
 * Segmento 0: rosa → morado | Segmento 1: cyan → azul marino
 */
function createFinanceChartGradients(chart) {
    const { ctx, chartArea } = chart;
    if (!chartArea) return null;

    const spentGradient = ctx.createLinearGradient(
        chartArea.left, chartArea.top,
        chartArea.right, chartArea.bottom
    );
    spentGradient.addColorStop(0, '#FF6496');
    spentGradient.addColorStop(0.5, '#C44FD4');
    spentGradient.addColorStop(1, '#ffb800');

    const availableGradient = ctx.createLinearGradient(
        chartArea.left, chartArea.bottom,
        chartArea.right, chartArea.top
    );
    availableGradient.addColorStop(0, '#00f0ff');
    availableGradient.addColorStop(0.5, '#00a8cc');
    availableGradient.addColorStop(1, '#0a2540');

    return [spentGradient, availableGradient];
}

/**
 * Dibuja el gráfico circular de presupuesto con Chart.js y gradientes fluidos.
 */
function initFinanceChart(gastado, disponible) {
    const canvas = document.getElementById('financeChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');

    if (financeChart) {
        financeChart.destroy();
    }

    financeChart = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: ['Gastado', 'Disponible'],
            datasets: [{
                data: [gastado, disponible],
                backgroundColor: (context) => {
                    const chart = context.chart;
                    const gradients = createFinanceChartGradients(chart);
                    if (!gradients) {
                        return context.dataIndex === 0 ? '#FF6496' : '#00C8FF';
                    }
                    return gradients[context.dataIndex];
                },
                borderWidth: 0,
                borderColor: 'transparent',
                hoverOffset: 8,
                spacing: 3,
                borderRadius: 4,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            cutout: '58%',
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: true,
                    backgroundColor: 'rgba(16, 25, 40, 0.9)',
                    borderColor: 'rgba(100, 200, 255, 0.2)',
                    borderWidth: 1,
                    titleColor: '#E8EDF4',
                    bodyColor: '#4DE8FF',
                },
            },
            animation: { duration: 1200 },
        },
    });
}

/**
 * Lista eventos del día y el contador de correos en bandeja.
 */
function renderAgenda() {
    const { eventos } = mockData.agenda;

    const eventList = document.getElementById('eventList');
    eventList.innerHTML = eventos
        .map(
            (evento) => `
            <li class="event-item ${evento.destacado ? 'event-item--highlight' : ''}">
                <span class="event-item__diamond" style="background: ${evento.destacado ? '#ffb800' : '#00f0ff'}; color: ${evento.destacado ? '#ffb800' : '#00f0ff'}"></span>
                <div>
                    <p class="event-item__title">${evento.titulo}</p>
                    <p class="event-item__time">${evento.hora}</p>
                </div>
            </li>`
        )
        .join('');
}

/**
 * Carga los temas de estudio guardados en el navegador.
 */
function loadEstudioData() {
    try {
        const saved = localStorage.getItem(ESTUDIO_STORAGE_KEY);
        if (!saved) return;

        const parsed = JSON.parse(saved);

        if (Array.isArray(parsed.temas) && parsed.temas.length >= 2) {
            mockData.estudio.temas = parsed.temas.slice(0, 2).map((tema) => ({
                modulo: typeof tema.modulo === 'string' ? tema.modulo.trim() : mockData.estudio.temas[0].modulo,
                progreso: Math.min(100, Math.max(0, Math.round(Number(tema.progreso) || 0))),
            }));
            mockData.estudio.activo = parsed.activo === 1 ? 1 : 0;
            return;
        }

        // Compatibilidad con el formato anterior (un solo módulo)
        if (typeof parsed.modulo === 'string' && parsed.modulo.trim()) {
            mockData.estudio.temas[0].modulo = parsed.modulo.trim();
        }
        if (typeof parsed.progreso === 'number' && !Number.isNaN(parsed.progreso)) {
            mockData.estudio.temas[0].progreso = Math.min(100, Math.max(0, Math.round(parsed.progreso)));
        }
    } catch (error) {
        console.warn('No se pudo cargar el estudio guardado:', error);
    }
}

/**
 * Guarda los temas de estudio en localStorage.
 */
function saveEstudioData() {
    localStorage.setItem(ESTUDIO_STORAGE_KEY, JSON.stringify(mockData.estudio));
}

/**
 * Calcula el trazo del anillo según el porcentaje de avance.
 */
function getEstudioProgressOffset(progreso) {
    const circumference = 2 * Math.PI * 48;
    return circumference - (progreso / 100) * circumference;
}

/**
 * Devuelve el tema activo y el tema secundario.
 */
function getEstudioTemasVisibles() {
    const { activo, temas } = mockData.estudio;
    return {
        principal: temas[activo],
        secundario: temas[activo === 0 ? 1 : 0],
    };
}

/**
 * Intercambia el tema mostrado en el anillo principal y en el orbe.
 */
function swapEstudioTema() {
    mockData.estudio.activo = mockData.estudio.activo === 0 ? 1 : 0;
    saveEstudioData();
    renderEstudio(true);
}

/**
 * Actualiza la vista de la tarjeta de estudio con dos temas intercambiables.
 */
function renderEstudio(animateSwap = false) {
    const { principal, secundario } = getEstudioTemasVisibles();
    const mainBtn = document.getElementById('estudioMainBtn');
    const secondaryBtn = document.getElementById('estudioSecondaryBtn');

    document.getElementById('estudioProgreso').textContent = `${principal.progreso}%`;
    document.getElementById('estudioModulo').textContent = principal.modulo;
    document.getElementById('estudioSecondaryProgreso').textContent = `${secundario.progreso}%`;

    document.getElementById('estudioProgressCircle').style.strokeDashoffset = getEstudioProgressOffset(principal.progreso);
    document.getElementById('estudioSecondaryCircle').style.strokeDashoffset = getEstudioProgressOffset(secundario.progreso);

    mainBtn.setAttribute('aria-label', `Tema activo: ${principal.modulo}, ${principal.progreso}%`);
    secondaryBtn.setAttribute('aria-label', `Cambiar a ${secundario.modulo}, ${secundario.progreso}%`);

    if (animateSwap) {
        mainBtn.classList.add('estudio-swap-btn--pulse');
        secondaryBtn.classList.add('estudio-swap-btn--pulse');
        window.setTimeout(() => {
            mainBtn.classList.remove('estudio-swap-btn--pulse');
            secondaryBtn.classList.remove('estudio-swap-btn--pulse');
        }, 450);
    }
}

/**
 * Permite editar el tema activo en la tarjeta de estudio.
 */
function initEstudioEditor() {
    const view = document.getElementById('estudioView');
    const form = document.getElementById('estudioForm');
    const editBtn = document.getElementById('estudioEditBtn');
    const cancelBtn = document.getElementById('estudioCancelBtn');
    const mainBtn = document.getElementById('estudioMainBtn');
    const secondaryBtn = document.getElementById('estudioSecondaryBtn');
    const topicLabel = document.getElementById('estudioFormTopicLabel');
    const moduloInput = document.getElementById('estudioModuloInput');
    const progresoInput = document.getElementById('estudioProgresoInput');
    const progresoOutput = document.getElementById('estudioProgresoOutput');

    function syncFormValues() {
        const temaActivo = mockData.estudio.temas[mockData.estudio.activo];
        moduloInput.value = temaActivo.modulo;
        progresoInput.value = String(temaActivo.progreso);
        progresoOutput.textContent = `${temaActivo.progreso}%`;
        topicLabel.textContent = `Tema ${mockData.estudio.activo + 1} (activo)`;
    }

    function openEdit() {
        syncFormValues();
        view.hidden = true;
        form.classList.remove('estudio-form--hidden');
        editBtn.setAttribute('aria-expanded', 'true');
        moduloInput.focus();
        moduloInput.select();
    }

    function closeEdit() {
        view.hidden = false;
        form.classList.add('estudio-form--hidden');
        editBtn.setAttribute('aria-expanded', 'false');
    }

    editBtn.addEventListener('click', openEdit);
    cancelBtn.addEventListener('click', closeEdit);
    mainBtn.addEventListener('click', swapEstudioTema);
    secondaryBtn.addEventListener('click', swapEstudioTema);

    progresoInput.addEventListener('input', () => {
        progresoOutput.textContent = `${progresoInput.value}%`;
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();

        const modulo = moduloInput.value.trim();
        const progreso = Math.min(100, Math.max(0, Number(progresoInput.value) || 0));
        const temaActivo = mockData.estudio.temas[mockData.estudio.activo];

        temaActivo.modulo = modulo || temaActivo.modulo;
        temaActivo.progreso = progreso;

        saveEstudioData();
        renderEstudio();
        closeEdit();
    });
}

/**
 * Muestra terapia y ejercicio del día en la tarjeta de optimización física.
 */
function renderHabitos() {
    document.getElementById('terapiaValue').textContent = mockData.habitos.terapia;
    document.getElementById('ejercicioValue').textContent = mockData.habitos.ejercicio;
}

/**
 * Renderiza las métricas del radar de búsqueda profesional.
 * Los datos críticos (entrevistas) usan acento dorado en el HUD.
 */
function renderBusquedaProfesional() {
    const { postulacionesSemana, entrevistasPendientes, estado } = mockData.busquedaProfesional;

    document.getElementById('postulacionesValue').textContent = postulacionesSemana;
    document.getElementById('entrevistasValue').textContent = entrevistasPendientes;
    document.getElementById('radarEstado').textContent = estado;
}

/**
 * Actualiza el gráfico de finanzas si ya existe (tras registrar un gasto por voz).
 */
function refreshFinanceUI() {
    const { presupuesto, gastado } = mockData.finanzas;
    const disponible = presupuesto - gastado;

    document.getElementById('gastadoValue').textContent = formatCLP(gastado);
    document.getElementById('disponibleValue').textContent = formatCLP(disponible);

    if (financeChart) {
        financeChart.data.datasets[0].data = [gastado, disponible];
        financeChart.update();
    } else {
        initFinanceChart(gastado, disponible);
    }
}

/**
 * Resalta brevemente una tarjeta al navegar hacia ella.
 */
function focusCard(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;

    card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    card.classList.add('card--focused');
    window.setTimeout(() => card.classList.remove('card--focused'), 1400);
}

/**
 * Marca el ítem activo en el menú lateral según la tarjeta visible.
 */
function setActiveNav(targetId) {
    document.querySelectorAll('.sidebar__nav .nav-item').forEach((btn) => {
        btn.classList.toggle('nav-item--active', btn.dataset.target === targetId);
    });
}

/**
 * Navega a una sección del dashboard desde el sidebar o por voz.
 */
function navigateToSection(cardId) {
    if (!cardId) return;
    focusCard(cardId);
    setActiveNav(cardId);
    closeMobileMenu();
}

/**
 * Conecta los botones del sidebar con las tarjetas del grid.
 */
function initNavigation() {
    document.querySelectorAll('.sidebar__nav .nav-item').forEach((btn) => {
        btn.addEventListener('click', () => {
            navigateToSection(btn.dataset.target);
        });
    });
}

/**
 * Intenta cargar datos remotos desde n8n. Si falla, mantiene mockData.
 */
async function loadRemoteData() {
    if (!API_ENABLED) return;

    try {
        const [summary, garmin, finance, agenda, estudio, fitness] = await Promise.all([
            fetchMorningSummary(),
            fetchGarminMetrics(),
            fetchFinanceData(),
            fetchAgendaEvents(),
            fetchUciProgress(),
            fetchFitnessRoutine(),
        ]);

        if (summary?.saludo || summary?.text) {
            mockData.saludo = summary.saludo || summary.text;
        }
        if (garmin?.bodyBattery != null) {
            mockData.garmin.bodyBattery = garmin.bodyBattery;
        }
        if (garmin?.sueno) {
            mockData.garmin.sueno = garmin.sueno;
        }
        if (finance?.presupuesto != null && finance?.gastado != null) {
            mockData.finanzas.presupuesto = finance.presupuesto;
            mockData.finanzas.gastado = finance.gastado;
        }
        if (Array.isArray(agenda?.eventos)) {
            mockData.agenda.eventos = agenda.eventos;
        }
        if (estudio?.temas?.length >= 2) {
            mockData.estudio.temas = estudio.temas.slice(0, 2);
        } else if (estudio?.modulo) {
            mockData.estudio.temas[0].modulo = estudio.modulo;
            mockData.estudio.temas[0].progreso = estudio.progreso ?? mockData.estudio.temas[0].progreso;
        }
        if (fitness?.terapia) {
            mockData.habitos.terapia = fitness.terapia;
        }
        if (fitness?.ejercicio) {
            mockData.habitos.ejercicio = fitness.ejercicio;
        }
    } catch (error) {
        console.warn('[Dashboard] API no disponible, usando datos locales:', error.message);
    }
}

/**
 * Procesa comandos de voz localmente cuando no hay backend o como respuesta rápida.
 */
function processLocalVoiceCommand(transcript) {
    const text = transcript.toLowerCase().trim();

    const navMap = [
        { keys: ['inicio', 'panel', 'saludo'], target: 'cardSaludo' },
        { keys: ['recuperación', 'recuperacion', 'garmin', 'body battery', 'batería'], target: 'cardRecuperacion' },
        { keys: ['finanza', 'presupuesto', 'gasto'], target: 'cardFinanzas' },
        { keys: ['agenda', 'calendario', 'evento'], target: 'cardAgenda' },
        { keys: ['estudio', 'módulo', 'modulo', 'uci'], target: 'cardEstudio' },
        { keys: ['radar', 'postulación', 'postulacion', 'entrevista', 'trabajo'], target: 'cardRadar' },
        { keys: ['salud', 'hábito', 'habito', 'terapia', 'ejercicio'], target: 'cardHabitos' },
    ];

    for (const item of navMap) {
        if (item.keys.some((key) => text.includes(key))) {
            navigateToSection(item.target);
            return `Navegando a ${item.keys[0]}.`;
        }
    }

    const expenseMatch = text.match(/gast[eé]\s+(\d[\d.]*)\s*(mil|lucas|pesos)?/i);
    if (expenseMatch) {
        let amount = Number(expenseMatch[1].replace(/\./g, ''));
        if (expenseMatch[2] && /mil|lucas/i.test(expenseMatch[2])) {
            amount *= 1000;
        }
        mockData.finanzas.gastado += amount;
        refreshFinanceUI();
        focusCard('cardFinanzas');
        return `Gasto de ${formatCLP(amount)} registrado localmente.`;
    }

    if (text.includes('resumen') || text.includes('cómo estoy') || text.includes('como estoy')) {
        navigateToSection('cardSaludo');
        return mockData.saludo;
    }

    return 'Comando no reconocido. Prueba: "ir a finanzas", "gasté 5000" o "mostrar agenda".';
}

/**
 * Muestra feedback del asistente de voz en el hint flotante.
 */
function showVoiceFeedback(message, listening = false) {
    const hint = document.getElementById('voiceHint');
    const hintText = document.getElementById('voiceHintText');

    hintText.textContent = message;
    hint.classList.toggle('voice-hint--visible', true);
    hint.setAttribute('aria-hidden', 'false');

    if (!listening) {
        window.setTimeout(() => {
            if (!isMicActive) {
                hint.classList.remove('voice-hint--visible');
                hint.setAttribute('aria-hidden', 'true');
            }
        }, 4500);
    }
}

/**
 * Inicia el reconocimiento de voz con Web Speech API.
 */
function startListening() {
    if (!speechRecognition) return;

    try {
        speechRecognition.start();
        showVoiceFeedback('Escuchando…', true);
    } catch (error) {
        console.warn('[Voz] No se pudo iniciar:', error.message);
        showVoiceFeedback('Micrófono no disponible en este navegador.');
        stopListening();
    }
}

/**
 * Detiene el reconocimiento de voz y restaura la UI.
 */
function stopListening() {
    if (speechRecognition) {
        try {
            speechRecognition.stop();
        } catch (error) {
            console.warn('[Voz] Error al detener:', error.message);
        }
    }

    isMicActive = false;
    const fab = document.getElementById('fab-mic');
    fab.classList.remove('fab--active');
    fab.setAttribute('aria-pressed', 'false');
}

/**
 * Configura Web Speech API y enlaza el botón flotante del micrófono.
 */
function initVoiceAssistant() {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
        document.getElementById('fab-mic').addEventListener('click', () => {
            showVoiceFeedback('Tu navegador no soporta reconocimiento de voz. Usa Chrome o Edge.');
        });
        return;
    }

    speechRecognition = new SpeechRecognition();
    speechRecognition.lang = 'es-CL';
    speechRecognition.continuous = false;
    speechRecognition.interimResults = false;

    speechRecognition.onresult = async (event) => {
        const transcript = event.results[0][0].transcript;
        showVoiceFeedback(`"${transcript}"`, true);

        let response = processLocalVoiceCommand(transcript);

        if (API_ENABLED) {
            const remote = await sendVoiceCommand(transcript);
            if (remote?.message) {
                response = remote.message;
            }
            if (remote?.action === 'refresh_finance') {
                await loadRemoteData();
                initDashboard();
            }
        }

        showVoiceFeedback(response);
        stopListening();
    };

    speechRecognition.onerror = (event) => {
        const messages = {
            'no-speech': 'No detecté voz. Intenta de nuevo.',
            'not-allowed': 'Permiso de micrófono denegado.',
            aborted: 'Escucha cancelada.',
        };
        showVoiceFeedback(messages[event.error] || 'Error al escuchar.');
        stopListening();
    };

    speechRecognition.onend = () => {
        if (isMicActive) {
            isMicActive = false;
            document.getElementById('fab-mic').classList.remove('fab--active');
            document.getElementById('fab-mic').setAttribute('aria-pressed', 'false');
        }
    };

    document.getElementById('fab-mic').addEventListener('click', toggleMic);
}

/**
 * Registra el Service Worker para comportamiento PWA offline básico.
 */
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', () => {
        navigator.serviceWorker.register('/sw.js').catch((error) => {
            console.warn('[PWA] No se pudo registrar el Service Worker:', error.message);
        });
    });
}
/**
 * Punto central: renderiza todas las tarjetas con los datos disponibles.
 */
function initDashboard() {
    renderDate();
    renderRecuperacion();
    loadEstudioData();

    const financeValues = renderFinanzas();
    initFinanceChart(financeValues.gastado, financeValues.disponible);

    renderAgenda();
    renderEstudio();
    renderBusquedaProfesional();
    renderHabitos();
}

/* ==========================================================================
   Sidebar móvil
   ========================================================================== */

function initSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const toggle = document.getElementById('menuToggle');

    function openMenu() {
        sidebar.classList.add('sidebar--open');
        overlay.classList.add('sidebar-overlay--visible');
        toggle.setAttribute('aria-expanded', 'true');
    }

    function closeMenu() {
        sidebar.classList.remove('sidebar--open');
        overlay.classList.remove('sidebar-overlay--visible');
        toggle.setAttribute('aria-expanded', 'false');
    }

    toggle.addEventListener('click', () => {
        sidebar.classList.contains('sidebar--open') ? closeMenu() : openMenu();
    });

    overlay.addEventListener('click', closeMenu);
    closeMobileMenu = closeMenu;
}

/* ==========================================================================
   FAB — Conexión con webhook n8n
   ========================================================================== */

const FAB_MIC_WEBHOOK_BASE =
    'http://34.123.160.45:5678/webhook-test/d249770d-bec2-426f-98ac-35af544dfb5e';

/**
 * Resplandor magenta temporal al pulsar el micrófono (retroalimentación visual).
 */
function triggerFabMicGlow(fab) {
    fab.classList.add('fab--syncing');
    setTimeout(() => {
        fab.classList.remove('fab--syncing');
    }, 800);
}

/**
 * Envía la señal al webhook n8n como Simple Request (GET + no-cors) para evitar CORS.
 */
function sendFabMicWebhook() {
    const params = new URLSearchParams({
        evento: 'microfono_activado',
        usuario: 'Enfermero Profesional',
        accion: 'solicitud_sincronizacion',
    });

    const finalUrl = `${FAB_MIC_WEBHOOK_BASE}?${params.toString()}`;

    return fetch(finalUrl, {
        method: 'GET',
        mode: 'no-cors',
    })
        .then(() => {
            console.log('Señal enviada silenciosamente al backend.');
        })
        .catch((err) => console.error('Error enviando señal:', err));
}

/**
 * Enlaza el botón flotante del micrófono con el servidor n8n.
 */
function initFabMic() {
    const fab = document.getElementById('fab-mic');
    if (!fab) {
        console.warn('[FAB] No se encontró el botón #fab-mic');
        return;
    }

    fab.addEventListener('click', () => {
        triggerFabMicGlow(fab);
        sendFabMicWebhook();
    });
}

/* ==========================================================================
   Arranque
   ========================================================================== */

document.addEventListener('DOMContentLoaded', async () => {
    registerServiceWorker();
    initSidebar();
    initNavigation();
    initEstudioEditor();
    initFabMic();

    await loadRemoteData();
    initDashboard();
    renderSaludoAnimado();

    document.addEventListener('click', () => initTypingAudioContext(), { once: true });
});
