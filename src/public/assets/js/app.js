
(() => {
    const state = {
        token: sessionStorage.getItem('authToken'),
        user: null,
        clientes: [],
        emprestimos: [],
    };

    const dom = {};
    const API_BASE_URL = (() => {
        if (window.API_BASE_URL) return window.API_BASE_URL;
        const { origin, protocol } = window.location;
        const isFile = protocol === 'file:' || origin === 'null' || !origin;
        if (isFile) return 'http://localhost:3000';
        return origin;
    })();

    function buildApiUrl(path) {
        if (/^https?:\/\//i.test(path)) {
            return path;
        }
        if (!path.startsWith('/')) {
            path = `/${path}`;
        }
        return `${API_BASE_URL}${path}`;
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function escapeAttr(value) {
        return escapeHtml(value).replace(/`/g, '&#96;');
    }

    function escapeJsString(value) {
        return String(value ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
    }

    function safeText(value, fallback = '-') {
        const text = String(value ?? '').trim();
        return text ? escapeHtml(text) : fallback;
    }

    function parseMoney(value) {
        const numeric = Number(value);
        return Number.isFinite(numeric) ? numeric : 0;
    }

    /**
     * Formata um valor numérico para o padrão monetário brasileiro
     * @param {number} value - Valor a ser formatado
     * @param {boolean} includeSymbol - Se deve incluir o símbolo R$ (padrão: true)
     * @returns {string} - Valor formatado (ex: "R$ 1.500,00")
     */
    function formatMoney(value, includeSymbol = true) {
        const numValue = parseMoney(value);
        const formatted = numValue.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        });
        return includeSymbol ? `R$ ${formatted}` : formatted;
    }

    /**
     * Formata uma porcentagem no padrão brasileiro
     * @param {number} value - Valor a ser formatado
     * @returns {string} - Valor formatado (ex: "5,50%")
     */
    function formatPercent(value) {
        const numValue = parseMoney(value);
        return numValue.toLocaleString('pt-BR', {
            minimumFractionDigits: 2,
            maximumFractionDigits: 2
        }) + '%';
    }

    /**
     * Parse um valor formatado no padrão brasileiro para número
     * @param {string} value - Valor formatado (ex: "1.500,00" ou "1500,00")
     * @returns {number} - Número parseado
     */
    function parseBRMoney(value) {
        if (typeof value === 'number') return value;
        if (!value) return 0;

        // Remove R$, espaços e pontos (separador de milhares)
        const cleaned = String(value)
            .replace(/R\$/g, '')
            .replace(/\s/g, '')
            .replace(/\./g, '')
            .replace(',', '.');

        const num = parseFloat(cleaned);
        return isNaN(num) ? 0 : num;
    }

    /**
     * Formata um input enquanto o usuário digita (máscara brasileira)
     * @param {string} value - Valor digitado
     * @param {boolean} addZeros - Se deve adicionar zeros automaticamente
     * @returns {string} - Valor formatado
     */
    function formatInputMoney(value, addZeros = false) {
        if (!value) return '';

        // Remove tudo exceto números e vírgula
        let cleaned = String(value).replace(/[^\d,]/g, '');

        // Garante apenas uma vírgula
        const parts = cleaned.split(',');
        if (parts.length > 2) {
            cleaned = parts[0] + ',' + parts.slice(1).join('');
        }

        // Separa parte inteira e decimal
        const [intPart, decPart] = cleaned.split(',');

        if (!intPart) return '';

        // Formata parte inteira com pontos de milhares
        const formattedInt = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

        // Limita casas decimais a 2
        let formattedDec = decPart !== undefined ? decPart.substring(0, 2) : '';

        // Se tem vírgula ou addZeros é true, garante 2 casas decimais
        if (decPart !== undefined || addZeros) {
            formattedDec = formattedDec.padEnd(2, '0');
            return `${formattedInt},${formattedDec}`;
        }

        return formattedInt;
    }

    // ============================================
    // TOAST NOTIFICATION SYSTEM
    // ============================================
    const Toast = {
        container: null,

        init() {
            if (!this.container) {
                this.container = document.getElementById('toastContainer');
            }
        },

        show(message, type = 'info', duration = 5000) {
            this.init();

            const icons = {
                success: '✓',
                error: '✕',
                warning: '⚠',
                info: 'ℹ'
            };

            const titles = {
                success: 'Sucesso',
                error: 'Erro',
                warning: 'Atenção',
                info: 'Informação'
            };

            const toast = document.createElement('div');
            toast.className = `toast ${type}`;
            toast.innerHTML = `
                <div class="toast-icon">${icons[type] || icons.info}</div>
                <div class="toast-content">
                    <div class="toast-title">${titles[type] || titles.info}</div>
                    <div class="toast-message">${escapeHtml(message)}</div>
                </div>
                <button class="toast-close" onclick="this.parentElement.classList.add('removing'); setTimeout(() => this.parentElement.remove(), 300)">✕</button>
            `;

            this.container.appendChild(toast);

            // Auto remove
            if (duration > 0) {
                setTimeout(() => {
                    toast.classList.add('removing');
                    setTimeout(() => toast.remove(), 300);
                }, duration);
            }

            return toast;
        },

        success(message, duration) {
            return this.show(message, 'success', duration);
        },

        error(message, duration) {
            return this.show(message, 'error', duration);
        },

        warning(message, duration) {
            return this.show(message, 'warning', duration);
        },

        info(message, duration) {
            return this.show(message, 'info', duration);
        }
    };

    // ============================================
    // LOADING STATE HELPERS
    // ============================================
    function setButtonLoading(button, loading) {
        if (loading) {
            button.classList.add('loading');
            button.disabled = true;
        } else {
            button.classList.remove('loading');
            button.disabled = false;
        }
    }

    function showSkeleton(containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = `
            <div class="skeleton skeleton-card"></div>
            <div class="skeleton skeleton-line" style="width: 80%"></div>
            <div class="skeleton skeleton-line" style="width: 60%"></div>
            <div class="skeleton skeleton-line" style="width: 90%"></div>
        `;
    }

    // ============================================
    // TABLE SCROLL INDICATOR
    // ============================================
    function checkTableScroll(tableContainer) {
        if (!tableContainer) return;

        const table = tableContainer.querySelector('table');
        if (!table) return;

        if (table.scrollWidth > tableContainer.clientWidth) {
            tableContainer.classList.add('has-scroll');
        } else {
            tableContainer.classList.remove('has-scroll');
        }
    }

    let emprestimoSelecionado = null;
    let parcelaAtual = null;
    let ultimaSimulacao = null;

    // Inicializa os ícones de informação nos cards de estatísticas
    function initStatInfoIcons() {
        const icons = document.querySelectorAll('.stat-info-icon');
        icons.forEach(icon => {
            icon.addEventListener('click', function(e) {
                e.stopPropagation();

                // Remove popups ativos de outros ícones
                document.querySelectorAll('.stat-info-popup').forEach(popup => {
                    popup.remove();
                });
                document.querySelectorAll('.stat-info-icon.active').forEach(otherIcon => {
                    otherIcon.classList.remove('active');
                });

                // Toggle do ícone atual
                const wasActive = this.classList.contains('active');
                if (wasActive) {
                    this.classList.remove('active');
                    return;
                }

                this.classList.add('active');

                // Cria e mostra o popup
                const infoText = this.getAttribute('data-info');
                const popup = document.createElement('div');
                popup.className = 'stat-info-popup';
                popup.textContent = infoText;

                const card = this.closest('.stat-card');
                card.appendChild(popup);

                // Força reflow para animação
                setTimeout(() => popup.classList.add('show'), 10);

                // Fecha ao clicar fora
                const closePopup = (event) => {
                    if (!card.contains(event.target)) {
                        popup.classList.remove('show');
                        this.classList.remove('active');
                        setTimeout(() => popup.remove(), 300);
                        document.removeEventListener('click', closePopup);
                    }
                };
                setTimeout(() => document.addEventListener('click', closePopup), 10);
            });
        });
    }

    document.addEventListener('DOMContentLoaded', init);

    async function init() {
        cacheDom();
        bindEvents();
        configureInputs();
        initStatInfoIcons();
        if (dom.empData) {
            dom.empData.valueAsDate = new Date();
        }

        if (state.token) {
            try {
                await fetchProfile();
                await bootstrapData();
                showApp();
            } catch (error) {
                console.error(error);
                handleLogout('Sessão expirada. Faça login novamente.');
            }
        } else {
            showLogin();
        }
    }

    function cacheDom() {
        dom.loginScreen = document.getElementById('loginScreen');
        dom.loginForm = document.getElementById('loginForm');
        dom.loginEmail = document.getElementById('loginEmail');
        dom.loginPassword = document.getElementById('loginPassword');
        dom.loginError = document.getElementById('loginError');
        dom.registerForm = document.getElementById('registerForm');
        dom.registerName = document.getElementById('registerName');
        dom.registerEmail = document.getElementById('registerEmail');
        dom.registerPassword = document.getElementById('registerPassword');
        dom.registerPasswordConfirm = document.getElementById('registerPasswordConfirm');
        dom.registerError = document.getElementById('registerError');
        dom.showRegisterLink = document.getElementById('showRegisterLink');
        dom.showLoginLink = document.getElementById('showLoginLink');
        dom.appRoot = document.getElementById('appRoot');
        dom.logoutBtn = document.getElementById('logoutBtn');
        dom.currentUserName = document.getElementById('currentUserName');
        dom.globalAlert = document.getElementById('globalAlert');
        dom.empData = document.getElementById('empData');
        dom.emprestimoPagamento = document.getElementById('emprestimoPagamento');
        dom.modalPagamento = document.getElementById('modalPagamento');
        dom.modalTipoPagamento = document.getElementById('modalTipoPagamento');
        dom.modalValorPagamento = document.getElementById('modalValorPagamento');
        dom.modalDataPagamento = document.getElementById('modalDataPagamento');
        dom.modalObservacao = document.getElementById('modalObservacao');
        dom.infoParcelaSelecionada = document.getElementById('infoParcelaSelecionada');
        dom.importarJSON = document.getElementById('importarJSON');
    }

    function bindEvents() {
        if (dom.loginForm) {
            dom.loginForm.addEventListener('submit', handleLogin);
        }
        if (dom.registerForm) {
            dom.registerForm.addEventListener('submit', handleRegister);
        }
        if (dom.showRegisterLink) {
            dom.showRegisterLink.addEventListener('click', (e) => {
                e.preventDefault();
                showRegisterForm();
            });
        }
        if (dom.showLoginLink) {
            dom.showLoginLink.addEventListener('click', (e) => {
                e.preventDefault();
                showLoginForm();
            });
        }
        if (dom.logoutBtn) {
            dom.logoutBtn.addEventListener('click', () => handleLogout());
        }
        if (dom.emprestimoPagamento) {
            dom.emprestimoPagamento.addEventListener('change', carregarDetalhesPagamento);
        }
        if (dom.modalTipoPagamento) {
            dom.modalTipoPagamento.addEventListener('change', ajustarCamposPagamento);
        }
        if (dom.importarJSON) {
            dom.importarJSON.addEventListener('change', importarDadosJSON);
        }
        if (dom.modalValorPagamento) {
            dom.modalValorPagamento.addEventListener('input', () => {
                if (dom.modalTipoPagamento && dom.modalTipoPagamento.value === 'valor') {
                    simularAmortizacaoPreview();
                }
            });
        }
    }
    function configureInputs() {
        const cpfInput = document.getElementById('clienteCPF');
        if (cpfInput) {
            cpfInput.addEventListener('input', (event) => {
                let value = event.target.value.replace(/\D/g, '');
                if (value.length <= 11) {
                    value = value.replace(/(\d{3})(\d)/, '$1.$2');
                    value = value.replace(/(\d{3})(\d)/, '$1.$2');
                    value = value.replace(/(\d{3})(\d{1,2})$/, '$1-$2');
                    event.target.value = value;
                }
            });
        }

        const telefoneInput = document.getElementById('clienteTelefone');
        if (telefoneInput) {
            telefoneInput.addEventListener('input', (event) => {
                let value = event.target.value.replace(/\D/g, '');
                if (value.length <= 11) {
                    value = value.replace(/(\d{2})(\d)/, '($1) $2');
                    value = value.replace(/(\d{5})(\d)/, '$1-$2');
                    event.target.value = value;
                }
            });
        }

        // Máscaras dos campos do simulador
        const simValorInput = document.getElementById('simValor');
        const simTaxaInput = document.getElementById('simTaxa');

        function formatCentsToBR(cents) {
            return (cents / 100).toLocaleString('pt-BR', {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
            });
        }

        function attachCentavosMask(input) {
            if (!input) return;
            let cents = 0;

            const parseDigits = (value) => {
                const digits = String(value || '').replace(/\D/g, '');
                return digits ? parseInt(digits, 10) : 0;
            };

            const render = () => {
                input.value = formatCentsToBR(cents);
            };

            const syncFromCurrentValue = () => {
                cents = parseDigits(input.value);
                render();
            };

            input.addEventListener('focus', () => {
                if (!input.value) {
                    cents = 0;
                    render();
                }
            });

            input.addEventListener('keydown', (event) => {
                if (event.ctrlKey || event.metaKey || event.altKey) {
                    return;
                }

                if (event.key === 'Tab') return;
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight' || event.key === 'Home' || event.key === 'End') return;

                if (event.key === 'Backspace') {
                    cents = Math.floor(cents / 10);
                    render();
                    event.preventDefault();
                    return;
                }

                if (event.key === 'Delete') {
                    cents = 0;
                    render();
                    event.preventDefault();
                    return;
                }

                if (/^\d$/.test(event.key)) {
                    cents = (cents * 10) + Number(event.key);
                    render();
                    event.preventDefault();
                    return;
                }

                event.preventDefault();
            });

            input.addEventListener('paste', (event) => {
                event.preventDefault();
                const pastedText = event.clipboardData?.getData('text') || '';
                cents = parseDigits(pastedText);
                render();
            });

            input.addEventListener('input', () => {
                // Fallback para autofill e edições não capturadas por keydown.
                cents = parseDigits(input.value);
                render();
            });

            input.addEventListener('blur', () => {
                if (cents === 0) {
                    input.value = '';
                }
            });

            syncFromCurrentValue();
        }

        function sanitizeDecimalInput(rawValue) {
            let value = String(rawValue || '').replace(/[^\d,]/g, '');
            const firstComma = value.indexOf(',');
            if (firstComma !== -1) {
                const integerPart = value.slice(0, firstComma);
                const decimalPart = value.slice(firstComma + 1).replace(/,/g, '').slice(0, 2);
                value = decimalPart ? `${integerPart},${decimalPart}` : `${integerPart},`;
            }
            return value;
        }

        function attachTaxaMask(input) {
            if (!input) return;
            input.addEventListener('focus', (event) => {
                event.target.value = String(event.target.value || '').replace(/\./g, '');
            });
            input.addEventListener('input', (event) => {
                event.target.value = sanitizeDecimalInput(event.target.value);
            });
            input.addEventListener('blur', (event) => {
                const value = sanitizeDecimalInput(event.target.value);
                if (!value) {
                    event.target.value = '';
                    return;
                }
                const [intPart, decPart = ''] = value.split(',');
                event.target.value = decPart ? `${intPart},${decPart.padEnd(2, '0')}` : intPart;
            });
        }

        attachCentavosMask(simValorInput);
        attachTaxaMask(simTaxaInput);
    }
    async function apiRequest(path, { method = 'GET', body, skipAuth = false, headers = {} } = {}) {
        const options = { method, headers: { ...headers } };
        if (body !== undefined) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        }
        if (state.token && !skipAuth) {
            options.headers.Authorization = `Bearer ${state.token}`;
        }

        const url = buildApiUrl(path);
        let response;
        try {
            response = await fetch(url, options);
        } catch (networkError) {
            console.error('Erro ao alcançar o backend', networkError);
            throw new Error('Não foi possível se conectar ao servidor. Confira se ele está rodando em http://localhost:3000.');
        }
        if (response.status === 401) {
            handleLogout('Sessão expirada. Faça login novamente.');
            throw new Error('Não autorizado');
        }

        let data = null;
        let rawResponseText = '';
        if (response.status !== 204) {
            rawResponseText = await response.text();
            try {
                data = rawResponseText ? JSON.parse(rawResponseText) : null;
            } catch (error) {
                data = null;
            }
        }

        if (!response.ok) {
            const message =
                (typeof data === 'object' && data?.message) ||
                rawResponseText ||
                'Erro ao comunicar com o servidor';
            throw new Error(message);
        }
        return data;
    }

    async function handleLogin(event) {
        event.preventDefault();
        dom.loginError.textContent = '';
        const email = dom.loginEmail.value.trim().toLowerCase();
        const password = dom.loginPassword.value.trim();
        if (!email || !password) {
            dom.loginError.textContent = 'Informe e-mail e senha.';
            return;
        }
        try {
            const { token, user } = await apiRequest('/api/login', {
                method: 'POST',
                body: { email, password },
                skipAuth: true,
            });
            state.token = token;
            state.user = user;
            sessionStorage.setItem('authToken', token);
            dom.loginForm.reset();
            await bootstrapData();
            showApp();
            showAlert(`Bem-vindo, ${user.name}!`);
        } catch (error) {
            console.error(error);
            dom.loginError.textContent = error.message;
        }
    }

    async function handleRegister(event) {
        event.preventDefault();
        dom.registerError.textContent = '';

        const name = dom.registerName.value.trim();
        const email = dom.registerEmail.value.trim().toLowerCase();
        const password = dom.registerPassword.value.trim();
        const passwordConfirm = dom.registerPasswordConfirm.value.trim();

        // Validações
        if (!name || !email || !password || !passwordConfirm) {
            dom.registerError.textContent = 'Preencha todos os campos.';
            return;
        }

        if (password.length < 6) {
            dom.registerError.textContent = 'A senha deve ter pelo menos 6 caracteres.';
            return;
        }

        if (password !== passwordConfirm) {
            dom.registerError.textContent = 'As senhas não coincidem.';
            return;
        }

        try {
            const { token, user } = await apiRequest('/api/register', {
                method: 'POST',
                body: { name, email, password },
                skipAuth: true,
            });
            state.token = token;
            state.user = user;
            sessionStorage.setItem('authToken', token);
            dom.registerForm.reset();
            await bootstrapData();
            showApp();
            showAlert(`Bem-vindo, ${user.name}! Sua conta foi criada com sucesso.`);
        } catch (error) {
            console.error(error);
            dom.registerError.textContent = error.message;
        }
    }

    function showLoginForm() {
        dom.loginForm.classList.remove('hidden');
        dom.registerForm.classList.add('hidden');
        dom.loginError.textContent = '';
        dom.loginForm.reset();
    }

    function showRegisterForm() {
        dom.loginForm.classList.add('hidden');
        dom.registerForm.classList.remove('hidden');
        dom.registerError.textContent = '';
        dom.registerForm.reset();
    }

    function handleLogout(message) {
        state.token = null;
        state.user = null;
        state.clientes = [];
        state.emprestimos = [];
        sessionStorage.removeItem('authToken');
        dom.appRoot.classList.add('hidden');
        dom.loginScreen.classList.remove('hidden');
        if (message) {
            dom.loginError.textContent = message;
        }
    }

    function showApp() {
        dom.loginScreen.classList.add('hidden');
        dom.appRoot.classList.remove('hidden');
        if (state.user && dom.currentUserName) {
            dom.currentUserName.textContent = state.user.name;
        }
    }

    function showLogin() {
        dom.appRoot.classList.add('hidden');
        dom.loginScreen.classList.remove('hidden');
    }

    async function fetchProfile() {
        const user = await apiRequest('/api/profile');
        state.user = user;
        if (dom.currentUserName) {
            dom.currentUserName.textContent = user.name;
        }
    }

    async function bootstrapData() {
        await Promise.all([loadClientes(), loadEmprestimos()]);
        refreshUI();
    }

    async function loadClientes() {
        const clientes = await apiRequest('/api/clientes');
        state.clientes = clientes;
    }

    async function loadEmprestimos() {
        const emprestimos = await apiRequest('/api/emprestimos');
        state.emprestimos = emprestimos;
    }

    function refreshUI() {
        updateDashboard();
        updateClientesList();
        updateClientesSelect();
        updateEmprestimosList();
        updateEmprestimosSelect();
        updateHistorico();
        updateFiltroClientes();
        carregarDetalhesPagamento();
        // gráficos removidos
    }

    function showAlert(message, type = 'success') {
        // Use Toast system instead of old alert banner
        if (type === 'error') {
            Toast.error(message);
        } else if (type === 'success') {
            Toast.success(message);
        } else {
            Toast.info(message);
        }
    }
    function switchTab(tabName) {
        const trigger = window.event?.currentTarget;
        document.querySelectorAll('.tab').forEach((tab) => tab.classList.remove('active'));
        if (trigger) {
            trigger.classList.add('active');
        }
        document.querySelectorAll('.content').forEach((section) => section.classList.remove('active'));
        const target = document.getElementById(tabName);
        if (target) {
            target.classList.add('active');
        }
        if (tabName === 'dashboard') {
            updateDashboard();
            // gráficos removidos
        }
        if (tabName === 'clientes') updateClientesList();
        if (tabName === 'emprestimos') {
            updateEmprestimosList();
            updateClientesSelect();
        }
        if (tabName === 'pagamentos') updateEmprestimosSelect();
        if (tabName === 'relatorios') updateFiltroClientes();
        if (tabName === 'historico') updateHistorico();
    }

    function simular() {
        const valor = parseBRMoney(document.getElementById('simValor').value) || null;
        const taxa = parseBRMoney(document.getElementById('simTaxa').value) || null;
        const parcelas = parseInt(document.getElementById('simParcelas').value, 10) || null;

        if (!valor || !taxa || !parcelas || parcelas < 1) {
            Toast.warning('Preencha valor, taxa e quantidade de parcelas para calcular a simulação.');
            return;
        }

        const taxaDecimal = taxa / 100;
        const valorParcela = taxaDecimal > 0
            ? (valor * (taxaDecimal * Math.pow(1 + taxaDecimal, parcelas))) / (Math.pow(1 + taxaDecimal, parcelas) - 1)
            : valor / parcelas;
        const resultado = {
            valor,
            taxa,
            parcelas,
            valorParcela,
            totalPago: valorParcela * parcelas,
            jurosTotal: valorParcela * parcelas - valor,
        };
        exibirResultadoSimulacao(resultado);
    }

    function exibirResultadoSimulacao(resultado) {
        ultimaSimulacao = resultado;
        const container = document.getElementById('simulatorResult');
        if (!container) return;

        const optionsClientes = state.clientes
            .map((c) => `<option value="${escapeAttr(c.id)}">${safeText(c.nome)} - ${safeText(c.cpf)}</option>`)
            .join('');
        const hoje = new Date().toISOString().split('T')[0];

        container.innerHTML = `
            <div class="card" style="margin-top: 1.5rem; border: 1px solid var(--accent-primary);">
                <h3 style="color: var(--accent-primary); margin-bottom: 1rem;">Resultado da Simulação</h3>
                <div class="info-grid">
                    <div class="info-box">
                        <div class="info-label">Valor do Empréstimo</div>
                        <div class="info-value">${formatMoney(resultado.valor)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Taxa de Juros</div>
                        <div class="info-value">${formatPercent(resultado.taxa)} a.m.</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Parcelas</div>
                        <div class="info-value">${resultado.parcelas}x</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Valor da Parcela</div>
                        <div class="info-value">${formatMoney(resultado.valorParcela)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Total a Pagar</div>
                        <div class="info-value">${formatMoney(resultado.totalPago)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Total de Juros</div>
                        <div class="info-value">${formatMoney(resultado.jurosTotal)}</div>
                    </div>
                </div>
                <div style="margin-top: 2rem; padding-top: 1rem; border-top: 1px solid var(--border-color);">
                    <h4 style="margin-bottom: 1rem;">Efetivar Empréstimo</h4>
                    <p class="muted" style="margin-bottom: 1rem;">Selecione o cliente para vincular a esta simulação e criar o empréstimo.</p>
                    <div class="form-grid">
                        <div class="form-group">
                            <label for="simCliente">Cliente</label>
                            <select id="simCliente">
                                <option value="">Selecione um cliente...</option>
                                ${optionsClientes}
                            </select>
                        </div>
                        <div class="form-group">
                            <label for="simData">Data do Empréstimo</label>
                            <input type="date" id="simData" value="${hoje}">
                        </div>
                    </div>
                    <button class="btn btn-primary" onclick="confirmarEmprestimoSimulado()">✅ Confirmar e Criar Empréstimo</button>
                </div>
            </div>
        `;
    }

    async function confirmarEmprestimoSimulado() {
        if (!ultimaSimulacao) {
            Toast.warning('Faça uma simulação primeiro.');
            return;
        }

        const clienteId = document.getElementById('simCliente').value;
        const data = document.getElementById('simData').value;

        if (!clienteId) {
            Toast.warning('Selecione um cliente para continuar.');
            return;
        }
        if (!data) {
            Toast.warning('Selecione a data do empréstimo.');
            return;
        }

        const { valor, taxa, parcelas, valorParcela, totalPago, jurosTotal } = ultimaSimulacao;
        
        // Recalcular detalhamento das parcelas
        const parcelasDetalhadas = [];
        const dataBase = new Date(data);
        for (let i = 1; i <= parcelas; i += 1) {
            const dataParcela = new Date(dataBase);
            dataParcela.setMonth(dataParcela.getMonth() + i);
            parcelasDetalhadas.push({
                numero: i,
                valor: valorParcela,
                dataVencimento: dataParcela.toISOString().split('T')[0],
                status: 'pendente',
                dataPagamento: null,
                valorPago: 0,
            });
        }

        const payload = {
            clienteId,
            valor,
            valorOriginal: valor,
            saldoDevedor: totalPago,
            taxa,
            parcelas,
            parcelasRestantes: parcelas,
            valorParcela,
            totalPagar: totalPago,
            jurosTotal,
            dataEmprestimo: data,
            status: 'ativo',
            parcelasDetalhadas,
            historicoRecalculos: [],
        };

        try {
            const emprestimo = await apiRequest('/api/emprestimos', { method: 'POST', body: payload });
            state.emprestimos.unshift(emprestimo);
            
            // Limpar simulação
            document.getElementById('simulatorResult').innerHTML = '';
            ultimaSimulacao = null;
            document.getElementById('simValor').value = '';
            document.getElementById('simTaxa').value = '';
            document.getElementById('simParcelas').value = '';

            updateEmprestimosList();
            updateDashboard();
            showAlert('Empréstimo criado com sucesso a partir da simulação!');
            switchTab('emprestimos');
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        }
    }

    async function cadastrarCliente() {
        const nome = document.getElementById('clienteNome').value.trim();
        const cpf = document.getElementById('clienteCPF').value.trim();
        const telefone = document.getElementById('clienteTelefone').value.trim();
        const email = document.getElementById('clienteEmail').value.trim();
        const endereco = document.getElementById('clienteEndereco').value.trim();
        if (!nome || !cpf) {
            Toast.warning('Nome e CPF são obrigatórios.');
            return;
        }
        try {
            const cliente = await apiRequest('/api/clientes', {
                method: 'POST',
                body: { nome, cpf, telefone, email, endereco },
            });
            state.clientes.unshift(cliente);
            document.getElementById('clienteNome').value = '';
            document.getElementById('clienteCPF').value = '';
            document.getElementById('clienteTelefone').value = '';
            document.getElementById('clienteEmail').value = '';
            document.getElementById('clienteEndereco').value = '';
            updateClientesList();
            updateClientesSelect();
            fecharModalCliente();
            showAlert('Cliente cadastrado com sucesso!');
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        }
    }

    function updateClientesList() {
        const container = document.getElementById('listaClientes');
        if (!container) return;
        if (state.clientes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">👥</div>
                    <p>Nenhum cliente cadastrado</p>
                </div>
            `;
            return;
        }
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Nome</th>
                        <th>CPF</th>
                        <th>Telefone</th>
                        <th>Lucro Gerado</th>
                        <th>Data Cadastro</th>
                    </tr>
                </thead>
                <tbody>
        `;
        state.clientes.forEach((cliente) => {
            const data = new Date(cliente.dataCadastro).toLocaleDateString('pt-BR');
            
            // Calcular lucro gerado por este cliente
            const emprestimosCliente = state.emprestimos.filter(e => e.clienteId === cliente.id);
            const lucroCliente = emprestimosCliente.reduce((sum, e) => {
                const { lucroRealizado } = calcularEstimativaLucro(e);
                return sum + lucroRealizado;
            }, 0);

            html += `
                <tr>
                    <td>${safeText(cliente.nome)}</td>
                    <td>${safeText(cliente.cpf)}</td>
                    <td>${safeText(cliente.telefone, '-')}</td>
                    <td style="color: var(--accent-primary); font-weight: bold;">${formatMoney(lucroCliente)}</td>
                    <td>${data}</td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function updateClientesSelect() {
        const select = document.getElementById('empCliente');
        if (!select) return;
        select.innerHTML = '<option value="">Selecione um cliente</option>';
        state.clientes.forEach((cliente) => {
            const option = document.createElement('option');
            option.value = cliente.id;
            option.textContent = `${cliente.nome} - ${cliente.cpf}`;
            select.appendChild(option);
        });
    }

    async function registrarEmprestimo() {
        const clienteId = document.getElementById('empCliente').value;
        const valor = parseFloat(document.getElementById('empValor').value);
        const taxa = parseFloat(document.getElementById('empTaxa').value);
        const parcelas = parseInt(document.getElementById('empParcelas').value, 10);
        const data = document.getElementById('empData').value;
        if (!clienteId || !valor || !taxa || !parcelas || !data) {
            Toast.warning('Preencha todos os campos do empréstimo.');
            return;
        }
        const taxaDecimal = taxa / 100;
        const valorParcela = (valor * (taxaDecimal * Math.pow(1 + taxaDecimal, parcelas))) / (Math.pow(1 + taxaDecimal, parcelas) - 1);
        const totalPagar = valorParcela * parcelas;
        const jurosTotal = totalPagar - valor;
        const parcelasDetalhadas = [];
        const dataBase = new Date(data);
        for (let i = 1; i <= parcelas; i += 1) {
            const dataParcela = new Date(dataBase);
            dataParcela.setMonth(dataParcela.getMonth() + i);
            parcelasDetalhadas.push({
                numero: i,
                valor: valorParcela,
                dataVencimento: dataParcela.toISOString().split('T')[0],
                status: 'pendente',
                dataPagamento: null,
                valorPago: 0,
            });
        }
        const payload = {
            clienteId,
            valor,
            valorOriginal: valor,
            saldoDevedor: totalPagar,
            taxa,
            parcelas,
            parcelasRestantes: parcelas,
            valorParcela,
            totalPagar,
            jurosTotal,
            dataEmprestimo: data,
            status: 'ativo',
            parcelasDetalhadas,
            historicoRecalculos: [],
        };
        try {
            const emprestimo = await apiRequest('/api/emprestimos', { method: 'POST', body: payload });
            state.emprestimos.unshift(emprestimo);
            document.getElementById('empCliente').value = '';
            document.getElementById('empValor').value = '';
            document.getElementById('empTaxa').value = '';
            document.getElementById('empParcelas').value = '';
            document.getElementById('empData').value = '';
            updateEmprestimosList();
            updateDashboard();
            fecharModalEmprestimo();
            showAlert('Empréstimo registrado com sucesso!');
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        }
    }

    function updateEmprestimosList() {
        const container = document.getElementById('listaEmprestimos');
        if (!container) return;
        if (state.emprestimos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">💸</div>
                    <p>Nenhum empréstimo registrado</p>
                </div>
            `;
            return;
        }
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th>Valor</th>
                        <th>Taxa</th>
                        <th>Parcelas</th>
                        <th>Valor Parcela</th>
                        <th>Total a Pagar</th>
                        <th>Data</th>
                        <th>Status</th>
                        <th>Ações</th>
                    </tr>
                </thead>
                <tbody>
        `;
        state.emprestimos.forEach((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            const data = new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR');
            const statusLabel = safeText(emp.status, 'indefinido');
            const empId = escapeJsString(emp.id);
            html += `
                <tr>
                    <td>${cliente ? safeText(cliente.nome) : 'Cliente não encontrado'}</td>
                    <td>${formatMoney(emp.valor)}</td>
                    <td>${formatPercent(emp.taxa)}</td>
                    <td>${parseMoney(emp.parcelas)}x</td>
                    <td>${formatMoney(emp.valorParcela)}</td>
                    <td>${formatMoney(emp.totalPagar)}</td>
                    <td>${data}</td>
                    <td><span class="badge badge-${emp.status === 'ativo' ? 'active' : 'paid'}">${statusLabel}</span></td>
                    <td class="action-btns">
                        ${emp.status === 'ativo'
                            ? `<button class="btn btn-secondary btn-small" onclick="marcarComoPago('${empId}')">Pago</button>`
                            : '<span style="color: var(--text-secondary);">Finalizado</span>'}
                        <button class="btn btn-danger btn-small" onclick="excluirEmprestimo('${empId}')">Excluir</button>
                    </td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    async function marcarComoPago(id) {
        if (!confirm('Marcar este empréstimo como pago?')) return;
        try {
            const updated = await apiRequest(`/api/emprestimos/${id}`, { method: 'PATCH', body: { status: 'pago', saldoDevedor: 0, parcelasRestantes: 0 } });
            upsertEmprestimoLocal(updated);
            updateEmprestimosList();
            updateDashboard();
            updateHistorico();
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        }
    }

    async function excluirEmprestimo(id) {
        if (!confirm('Deseja realmente excluir este empréstimo?')) return;
        try {
            await apiRequest(`/api/emprestimos/${id}`, { method: 'DELETE' });
            state.emprestimos = state.emprestimos.filter((emp) => emp.id !== id);
            updateEmprestimosList();
            updateDashboard();
            updateHistorico();
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        }
    }

    function upsertEmprestimoLocal(updated) {
        const index = state.emprestimos.findIndex((e) => e.id === updated.id);
        if (index >= 0) {
            state.emprestimos[index] = updated;
        } else {
            state.emprestimos.unshift(updated);
        }
    }
    function calcularEstimativaLucro(emp) {
        // Se houver histórico, usa ele para total pago, senão usa parcelas
        let totalPago = 0;
        if (emp.historicoRecalculos && emp.historicoRecalculos.length > 0) {
            totalPago = emp.historicoRecalculos.reduce((sum, h) => sum + (h.valorPago || 0), 0);
        } else {
            totalPago = emp.parcelasDetalhadas
                .filter((p) => p.status === 'paga')
                .reduce((sum, p) => sum + (p.valorPago || 0), 0);
        }

        // Lucro Total do Contrato (Juros)
        const lucroTotal = emp.jurosTotal || 0;
        
        // Percentual de conclusão financeira
        // Evita divisão por zero
        const totalContrato = emp.valorOriginal + lucroTotal;
        const percentualPago = totalContrato > 0 ? totalPago / totalContrato : 0;
        
        // Lucro Realizado (Proporcional Linear)
        // Assume que cada parcela paga contém a mesma proporção de juros/principal média do contrato
        const lucroRealizado = lucroTotal * percentualPago;

        return { lucroTotal, lucroRealizado, totalPago };
    }

    function updateDashboard() {
        // 1. Total Emprestado (histórico): soma de tudo que já foi emprestado
        const totalEmprestado = state.emprestimos.reduce((sum, emp) => sum + (emp.valorOriginal || emp.valor || 0), 0);

        // Filtra apenas empréstimos ativos
        const ativos = state.emprestimos.filter((emp) => emp.status === 'ativo');

        let capitalInvestido = 0;
        let totalReceber = 0;
        let totalRecebido = 0;

        // 5. Total Já Recebido: calcula de TODOS os empréstimos (ativos e quitados)
        state.emprestimos.forEach((emp) => {
            let totalPago = 0;
            if (emp.historicoRecalculos && emp.historicoRecalculos.length > 0) {
                totalPago = emp.historicoRecalculos.reduce((sum, h) => sum + (h.valorPago || 0), 0);
            } else if (emp.parcelasDetalhadas) {
                totalPago = emp.parcelasDetalhadas
                    .filter((p) => p.status === 'paga')
                    .reduce((sum, p) => sum + p.valor, 0);
            }
            totalRecebido += totalPago;
        });

        // Calcula para cada empréstimo ativo
        ativos.forEach((emp) => {
            const valorOriginal = emp.valorOriginal || 0;
            const saldoDevedor = emp.saldoDevedor || 0;

            // Calcula quanto já foi pago
            let totalPago = 0;
            if (emp.historicoRecalculos && emp.historicoRecalculos.length > 0) {
                totalPago = emp.historicoRecalculos.reduce((sum, h) => sum + (h.valorPago || 0), 0);
            } else if (emp.parcelasDetalhadas) {
                totalPago = emp.parcelasDetalhadas
                    .filter((p) => p.status === 'paga')
                    .reduce((sum, p) => sum + p.valor, 0);
            }

            // 2. Capital Investido: quanto do seu dinheiro ainda está na rua
            // Capital Investido = Valor Original - Total Pago (limitado a zero)
            capitalInvestido += Math.max(valorOriginal - totalPago, 0);

            // 3. Total a Receber: soma dos saldos devedores
            totalReceber += saldoDevedor;
        });

        // 4. Lucro Estimado: Total a Receber - Capital Investido
        const lucroEstimado = Math.max(totalReceber - capitalInvestido, 0);

        // Atualiza o DOM
        document.getElementById('totalEmprestado').textContent = formatMoney(totalEmprestado);
        document.getElementById('capitalInvestido').textContent = formatMoney(capitalInvestido);
        document.getElementById('totalReceber').textContent = formatMoney(totalReceber);
        document.getElementById('lucroEstimado').textContent = formatMoney(lucroEstimado);
        document.getElementById('totalRecebido').textContent = formatMoney(totalRecebido);

        const container = document.getElementById('emprestimosAtivosTable');
        if (!container) return;
        const ativosRecentes = state.emprestimos.filter((emp) => emp.status === 'ativo').slice(0, 5);
        if (ativosRecentes.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📊</div>
                    <p>Nenhum empréstimo ativo</p>
                </div>
            `;
            return;
        }
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th>Valor Emprestado</th>
                        <th>Parcelas</th>
                        <th>Saldo a Receber</th>
                        <th>Lucro Est.</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
        `;
        ativosRecentes.forEach((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            const data = new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR');
            const { lucroTotal } = calcularEstimativaLucro(emp);
            html += `
                <tr>
                    <td>${cliente ? safeText(cliente.nome) : 'N/A'}</td>
                    <td>${formatMoney(emp.valorOriginal)}</td>
                    <td>${parseMoney(emp.parcelas)}x de ${formatMoney(emp.valorParcela)}</td>
                    <td>${formatMoney(emp.saldoDevedor)}</td>
                    <td style="color: var(--accent-primary);">${formatMoney(lucroTotal)}</td>
                    <td>${data}</td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function updateHistorico() {
        const container = document.getElementById('historicoCompleto');
        if (!container) return;
        if (state.emprestimos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">📜</div>
                    <p>Nenhum histórico disponível</p>
                </div>
            `;
            return;
        }
        const ordenados = [...state.emprestimos].sort((a, b) => new Date(b.dataEmprestimo) - new Date(a.dataEmprestimo));
        let html = `
            <table>
                <thead>
                    <tr>
                        <th>Data</th>
                        <th>Cliente</th>
                        <th>Valor</th>
                        <th>Taxa</th>
                        <th>Parcelas</th>
                        <th>Total Pago</th>
                        <th>Juros</th>
                        <th>Status</th>
                    </tr>
                </thead>
                <tbody>
        `;
        ordenados.forEach((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            const data = new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR');
            const statusLabel = safeText(emp.status, 'indefinido');
            html += `
                <tr>
                    <td>${data}</td>
                    <td>${cliente ? safeText(cliente.nome) : 'N/A'}</td>
                    <td>${formatMoney(parseMoney(emp.valor))}</td>
                    <td>${formatPercent(parseMoney(emp.taxa))}</td>
                    <td>${parseMoney(emp.parcelas)}x</td>
                    <td>${formatMoney(parseMoney(emp.totalPagar))}</td>
                    <td>${formatMoney(parseMoney(emp.jurosTotal))}</td>
                    <td><span class="badge badge-${emp.status === 'ativo' ? 'active' : 'paid'}">${statusLabel}</span></td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }

    function updateFiltroClientes() {
        const select = document.getElementById('filtroCliente');
        if (!select) return;
        select.innerHTML = '<option value="">Todos os clientes</option>';
        state.clientes.forEach((cliente) => {
            const option = document.createElement('option');
            option.value = cliente.id;
            option.textContent = cliente.nome;
            select.appendChild(option);
        });
    }
    function aplicarFiltros() {
        const clienteId = document.getElementById('filtroCliente').value;
        const status = document.getElementById('filtroStatus').value;
        const dataInicio = document.getElementById('filtroDataInicio').value;
        const dataFim = document.getElementById('filtroDataFim').value;
        let emprestimos = [...state.emprestimos];
        if (clienteId) emprestimos = emprestimos.filter((e) => e.clienteId === clienteId);
        if (status) emprestimos = emprestimos.filter((e) => e.status === status);
        if (dataInicio) emprestimos = emprestimos.filter((e) => e.dataEmprestimo >= dataInicio);
        if (dataFim) emprestimos = emprestimos.filter((e) => e.dataEmprestimo <= dataFim);
        exibirResultadosFiltrados(emprestimos);
    }

    function exibirResultadosFiltrados(emprestimos) {
        const container = document.getElementById('resultadosFiltrados');
        if (!container) return;
        if (emprestimos.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div class="empty-state-icon">🔍</div>
                    <p>Nenhum resultado encontrado</p>
                </div>
            `;
            return;
        }
        const totalValor = emprestimos.reduce((sum, e) => sum + (e.valor || 0), 0);
        const totalSaldo = emprestimos.reduce((sum, e) => sum + (e.saldoDevedor || 0), 0);
        let html = `
            <div class="info-grid">
                <div class="info-box">
                    <div class="info-label">Total Filtrado</div>
                    <div class="info-value">${formatMoney(totalValor)}</div>
                </div>
                <div class="info-box">
                    <div class="info-label">Saldo Devedor</div>
                    <div class="info-value">${formatMoney(totalSaldo)}</div>
                </div>
                <div class="info-box">
                    <div class="info-label">Empréstimos</div>
                    <div class="info-value">${emprestimos.length}</div>
                </div>
            </div>
            <table>
                <thead>
                    <tr>
                        <th>Cliente</th>
                        <th>Valor</th>
                        <th>Taxa</th>
                        <th>Parcelas</th>
                        <th>Saldo</th>
                        <th>Status</th>
                        <th>Data</th>
                    </tr>
                </thead>
                <tbody>
        `;
        emprestimos.forEach((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            const statusLabel = safeText(emp.status, 'indefinido');
            html += `
                <tr>
                    <td>${cliente ? safeText(cliente.nome) : 'N/A'}</td>
                    <td>${formatMoney(parseMoney(emp.valor))}</td>
                    <td>${formatPercent(parseMoney(emp.taxa))}</td>
                    <td>${parseMoney(emp.parcelas)}x</td>
                    <td>${formatMoney(parseMoney(emp.saldoDevedor))}</td>
                    <td><span class="badge badge-${emp.status === 'ativo' ? 'active' : 'paid'}">${statusLabel}</span></td>
                    <td>${new Date(emp.dataEmprestimo).toLocaleDateString('pt-BR')}</td>
                </tr>
            `;
        });
        html += '</tbody></table>';
        container.innerHTML = html;
    }
    async function exportarDadosJSON() {
        const dados = { clientes: state.clientes, emprestimos: state.emprestimos, dataExportacao: new Date().toISOString() };
        const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `backup-emprestimos-${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    async function importarDadosJSON(event) {
        const file = event.target.files[0];
        if (!file) return;
        const confirmation = prompt('Importação apaga todos os dados atuais. Informe o token de confirmação para continuar:');
        if (!confirmation) {
            event.target.value = '';
            showAlert('Importação cancelada.', 'error');
            return;
        }
        const text = await file.text();
        try {
            const dados = JSON.parse(text);
            await apiRequest('/api/import', {
                method: 'POST',
                body: dados,
                headers: { 'x-import-confirmation': confirmation },
            });
            await bootstrapData();
            showAlert('Backup restaurado com sucesso!');
        } catch (error) {
            console.error(error);
            showAlert(error.message || 'Erro ao importar arquivo. Verifique o formato.', 'error');
        } finally {
            event.target.value = '';
        }
    }
    function updateEmprestimosSelect() {
        if (!dom.emprestimoPagamento) return;
        dom.emprestimoPagamento.innerHTML = '<option value="">Selecione um empréstimo</option>';
        // Mostrar primeiro os ativos, depois os finalizados, para permitir consulta de contratos pagos
        const ativos = state.emprestimos.filter((emp) => emp.status === 'ativo');
        const pagos = state.emprestimos.filter((emp) => emp.status === 'pago');
        [...ativos, ...pagos].forEach((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            const option = document.createElement('option');
            option.value = emp.id;
            const statusLabel = emp.status === 'ativo' ? `${emp.parcelasRestantes}/${emp.parcelas}` : 'Finalizado';
            option.textContent = `${cliente ? cliente.nome : 'N/A'} - ${formatMoney(emp.valor)} (${statusLabel})`;
            dom.emprestimoPagamento.appendChild(option);
        });
    }

    function carregarDetalhesPagamento() {
        if (!dom.emprestimoPagamento) return;
        const emprestimoId = dom.emprestimoPagamento.value;
        if (!emprestimoId) {
            document.getElementById('detalhesPagamento').innerHTML = '';
            emprestimoSelecionado = null;
            return;
        }
        emprestimoSelecionado = state.emprestimos.find((e) => e.id === emprestimoId);
        const cliente = state.clientes.find((c) => c.id === emprestimoSelecionado?.clienteId);
        if (!emprestimoSelecionado) {
            document.getElementById('detalhesPagamento').innerHTML = '';
            return;
        }
        const parcelasPagas = emprestimoSelecionado.parcelasDetalhadas.filter((p) => p.status === 'paga').length;
        const progressoPorcentagem = (parcelasPagas / emprestimoSelecionado.parcelas) * 100;
        
        // Novo cálculo de Total Pago incluindo amortizações
        let totalPago = 0;
        let totalAmortizado = 0;
        if (emprestimoSelecionado.historicoRecalculos && emprestimoSelecionado.historicoRecalculos.length > 0) {
            totalPago = emprestimoSelecionado.historicoRecalculos.reduce((sum, item) => sum + (item.valorPago || 0), 0);
            totalAmortizado = emprestimoSelecionado.historicoRecalculos
                .filter(h => h.tipo === 'amortizacao')
                .reduce((sum, h) => sum + (h.valorPago || 0), 0);
        } else {
            // Fallback para versões antigas sem histórico de pagamentos
            totalPago = emprestimoSelecionado.parcelasDetalhadas
                .filter((p) => p.status === 'paga')
                .reduce((sum, p) => sum + (p.valorPago || 0), 0);
        }

        const hoje = new Date().toISOString().split('T')[0];
        const clienteNome = cliente ? safeText(cliente.nome) : 'N/A';
        let html = `
            <div class="card">
                <h2 class="card-title">Controle de Pagamentos - ${clienteNome}</h2>
                <div class="info-grid">
                    <div class="info-box">
                        <div class="info-label">Valor Original</div>
                        <div class="info-value">${formatMoney(emprestimoSelecionado.valorOriginal)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Saldo Devedor</div>
                        <div class="info-value" style="color: var(--accent-warning);">${formatMoney(emprestimoSelecionado.saldoDevedor)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Total Pago</div>
                        <div class="info-value" style="color: var(--accent-secondary);">${formatMoney(totalPago)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Total Amortizado</div>
                        <div class="info-value" style="color: var(--accent-primary);">${formatMoney(totalAmortizado)}</div>
                    </div>
                    <div class="info-box">
                        <div class="info-label">Parcelas Pagas</div>
                        <div class="info-value">${parcelasPagas} / ${emprestimoSelecionado.parcelas}</div>
                    </div>
                </div>
                <div class="progress-bar">
                    <div class="progress-fill" style="width: ${progressoPorcentagem}%"></div>
                </div>
                <p class="muted" style="text-align:center; margin-top:0.5rem; font-size:0.9rem;">${progressoPorcentagem.toFixed(1)}% concluído</p>
            </div>
            <div class="card">
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:1.5rem;">
                    <h2 class="card-title" style="margin:0;">Parcelas</h2>
                    ${emprestimoSelecionado.status === 'ativo' ? `<button class="btn btn-secondary btn-small" onclick="abrirModalAmortizacao()">💰 Fazer Amortização</button>` : `<span class="muted" style="font-size:0.9rem;">Contrato finalizado — consulta somente</span>`}
                </div>
        `;
        emprestimoSelecionado.parcelasDetalhadas.forEach((parcela) => {
            const dataVenc = new Date(parcela.dataVencimento).toLocaleDateString('pt-BR');
            const atrasada = parcela.status === 'pendente' && parcela.dataVencimento < hoje;
            const classeStatus = parcela.status === 'paga' ? 'paga' : atrasada ? 'atrasada' : '';
            html += `
                <div class="parcela-card ${classeStatus}">
                    <div class="parcela-info">
                        <div class="parcela-numero">Parcela ${parcela.numero} ${parcela.status === 'paga' ? '✓' : ''} ${atrasada ? '⚠️ ATRASADA' : ''}</div>
                        <div class="parcela-detalhes">
                            Vencimento: ${dataVenc} | Valor: ${formatMoney(parcela.valor)}
                            ${parcela.status === 'paga' ? `<br>Pago em: ${new Date(parcela.dataPagamento).toLocaleDateString('pt-BR')} - ${formatMoney(parcela.valorPago)}` : ''}
                        </div>
                    </div>
                    <div class="parcela-actions">
                        ${parcela.status === 'pendente' && emprestimoSelecionado.status === 'ativo'
                            ? `<button class="btn btn-primary btn-small" onclick="abrirModalPagamento(${parcela.numero})">Pagar</button>`
                            : '<span style="color: var(--accent-primary); font-weight:600;">✓ Paga</span>'}
                    </div>
                </div>
            `;
        });
        html += '</div>';
        if (emprestimoSelecionado.historicoRecalculos?.length) {
            html += `
                <div class="card">
                    <h2 class="card-title">Histórico de Amortizações</h2>
                    <table>
                        <thead>
                            <tr>
                                <th>Data</th>
                                <th>Valor</th>
                                <th>Saldo Anterior</th>
                                <th>Novo Saldo</th>
                                <th>Observação</th>
                            </tr>
                        </thead>
                        <tbody>
            `;
            emprestimoSelecionado.historicoRecalculos.forEach((item) => {
                html += `
                    <tr>
                        <td>${new Date(item.data).toLocaleDateString('pt-BR')}</td>
                        <td>${formatMoney(parseMoney(item.valorPago))}</td>
                        <td>${formatMoney(parseMoney(item.saldoAnterior))}</td>
                        <td>${formatMoney(parseMoney(item.novoSaldo))}</td>
                        <td>${safeText(item.observacao, '-')}</td>
                    </tr>
                `;
            });
            html += '</tbody></table></div>';
        }
        document.getElementById('detalhesPagamento').innerHTML = html;
    }
    function abrirModalPagamento(numeroParcela) {
        if (!emprestimoSelecionado) {
            Toast.warning('Selecione um empréstimo primeiro.');
            return;
        }
        parcelaAtual = emprestimoSelecionado.parcelasDetalhadas.find((p) => p.numero === numeroParcela);
        if (!parcelaAtual) return;
        
        // Esconde o seletor de tipo de pagamento, pois o contexto já define (Pagamento de Parcela)
        const wrapperTipo = dom.modalTipoPagamento.closest('.form-group');
        if (wrapperTipo) wrapperTipo.style.display = 'none';

        dom.modalTipoPagamento.value = 'parcela';
        dom.modalValorPagamento.value = parcelaAtual.valor.toFixed(2);
        dom.modalDataPagamento.valueAsDate = new Date();
        dom.modalObservacao.value = '';
        dom.infoParcelaSelecionada.innerHTML = `
            <strong>Parcela ${parcelaAtual.numero}</strong><br>
            Vencimento: ${new Date(parcelaAtual.dataVencimento).toLocaleDateString('pt-BR')}<br>
            Valor: ${formatMoney(parcelaAtual.valor)}
        `;
        ajustarCamposPagamento();
        dom.modalPagamento.classList.add('active');
    }

    function abrirModalAmortizacao() {
        if (!emprestimoSelecionado) {
            Toast.warning('Selecione um empréstimo primeiro.');
            return;
        }
        parcelaAtual = null;
        const wrapperTipo = dom.modalTipoPagamento.closest('.form-group');
        if (wrapperTipo) wrapperTipo.style.display = 'none';
        dom.modalTipoPagamento.value = 'valor';
        dom.modalValorPagamento.value = '';
        dom.modalDataPagamento.valueAsDate = new Date();
        dom.modalObservacao.value = '';
        ajustarCamposPagamento();
        simularAmortizacaoPreview();
        dom.modalPagamento.classList.add('active');
    }

    function ajustarCamposPagamento() {
        const tipo = dom.modalTipoPagamento.value;
        const infoDiv = document.getElementById('modalParcelaInfo');
        infoDiv.style.display = tipo === 'parcela' ? 'block' : 'none';
        const previewGroup = document.getElementById('amortizacaoPreviewGroup');
        if (previewGroup) {
            previewGroup.style.display = tipo === 'valor' ? 'block' : 'none';
        }
    }

    function fecharModal() {
        dom.modalPagamento.classList.remove('active');
        parcelaAtual = null;
    }

    async function confirmarPagamento() {
        if (!emprestimoSelecionado) {
            Toast.warning('Selecione um empréstimo.');
            return;
        }
        const tipo = dom.modalTipoPagamento.value;
        const valor = parseFloat(dom.modalValorPagamento.value);
        const data = dom.modalDataPagamento.value;
        const observacao = dom.modalObservacao.value;
        if (!valor || !data) {
            Toast.warning('Informe valor e data do pagamento.');
            return;
        }
        const emprestimo = { ...emprestimoSelecionado };
        emprestimo.historicoRecalculos = emprestimo.historicoRecalculos || [];
        if (tipo === 'parcela' && parcelaAtual) {
            const target = emprestimo.parcelasDetalhadas.find((p) => p.numero === parcelaAtual.numero);
            if (!target) return;
            target.status = 'paga';
            target.dataPagamento = data;
            target.valorPago = valor;
            emprestimo.parcelasRestantes = Math.max(emprestimo.parcelasRestantes - 1, 0);
            emprestimo.saldoDevedor = Math.max(emprestimo.saldoDevedor - valor, 0);
            emprestimo.historicoRecalculos.push({
                tipo: 'parcela',
                numeroParcela: target.numero,
                valorPago: valor,
                data,
                saldoAnterior: emprestimo.saldoDevedor + valor,
                novoSaldo: emprestimo.saldoDevedor,
                observacao: observacao || `Pagamento da parcela ${target.numero}`,
            });
        } else if (tipo === 'valor') {
            const saldoAnterior = emprestimo.saldoDevedor;
            
            // Clona parcelas para manipulação segura
            emprestimo.parcelasDetalhadas = JSON.parse(JSON.stringify(emprestimoSelecionado.parcelasDetalhadas));
            const pendentes = emprestimo.parcelasDetalhadas.filter((p) => p.status === 'pendente');
            
            // Ordena por vencimento
            pendentes.sort((a, b) => new Date(a.dataVencimento) - new Date(b.dataVencimento));

            let economia = 0;

            if (pendentes.length > 0) {
                // Total que seria pago antes da amortização
                const totalOriginalRestante = pendentes.reduce((sum, p) => sum + p.valor, 0);

                const taxaDecimal = emprestimo.taxa / 100;
                
                // 1. Calcular o Valor Presente (Principal) das parcelas restantes
                let pvTotal = 0;
                pendentes.forEach((p, index) => {
                    pvTotal += p.valor / Math.pow(1 + taxaDecimal, index + 1);
                });

                // 2. Abater a amortização do Principal
                let novoPrincipal = Math.max(pvTotal - valor, 0);
                
                // 3. Recalcular parcelas (PMT) com o Novo Principal
                const n = pendentes.length;
                let novoValorParcela = 0;
                
                if (novoPrincipal > 0) {
                    if (taxaDecimal > 0) {
                        novoValorParcela = (novoPrincipal * (taxaDecimal * Math.pow(1 + taxaDecimal, n))) / (Math.pow(1 + taxaDecimal, n) - 1);
                    } else {
                        novoValorParcela = novoPrincipal / n;
                    }
                }

                // 4. Atualizar parcelas
                pendentes.forEach((p) => {
                    p.valor = novoValorParcela;
                });
                emprestimo.valorParcela = novoValorParcela;
                
                // 5. Atualizar Saldo Devedor (Montante)
                emprestimo.saldoDevedor = novoValorParcela * n;

                // Calcular economia: (Total Original) - (Novo Total + Valor Amortizado)
                economia = totalOriginalRestante - (emprestimo.saldoDevedor + valor);
            } else {
                emprestimo.saldoDevedor = Math.max(emprestimo.saldoDevedor - valor, 0);
            }

            // Atualizar totais do contrato para refletir a nova realidade
            // Recalcula o total pago até agora
            const totalPagoAteAgora = (emprestimo.historicoRecalculos || []).reduce((sum, h) => sum + (h.valorPago || 0), 0) + valor;
            
            // O novo Total a Pagar será o que já foi pago + o que falta (novo saldo devedor)
            emprestimo.totalPagar = totalPagoAteAgora + emprestimo.saldoDevedor;
            
            // O novo Juros Total será o Total a Pagar - Valor Original Emprestado
            emprestimo.jurosTotal = Math.max(emprestimo.totalPagar - emprestimo.valorOriginal, 0);

            let obsFinal = observacao || 'Amortização com desconto de juros';
            if (economia > 0.01) {
                obsFinal += ` (Economia: ${formatMoney(economia)})`;
            }

            emprestimo.historicoRecalculos.push({
                tipo: 'amortizacao',
                valorPago: valor,
                data,
                saldoAnterior,
                novoSaldo: emprestimo.saldoDevedor,
                parcelasRestantes: pendentes.length,
                novoValorParcela: pendentes.length > 0 ? pendentes[0].valor : 0,
                observacao: obsFinal,
            });
        }
        if (emprestimo.parcelasRestantes <= 0 || emprestimo.saldoDevedor <= 0) {
            emprestimo.status = 'pago';
            emprestimo.saldoDevedor = 0;
        }
        const patchPayload = {
            saldoDevedor: emprestimo.saldoDevedor,
            parcelasRestantes: emprestimo.parcelasRestantes,
            valorParcela: emprestimo.valorParcela,
            totalPagar: emprestimo.totalPagar,
            jurosTotal: emprestimo.jurosTotal,
            status: emprestimo.status,
            parcelasDetalhadas: emprestimo.parcelasDetalhadas,
            historicoRecalculos: emprestimo.historicoRecalculos,
        };
        try {
            const updated = await apiRequest(`/api/emprestimos/${emprestimo.id}`, {
                method: 'PATCH',
                body: patchPayload,
            });
            upsertEmprestimoLocal(updated);
            
            // Preserva a seleção do empréstimo atual no dropdown
            const currentSelection = dom.emprestimoPagamento.value;
            
            updateDashboard();
            updateEmprestimosList();
            
            // Restaura a seleção se ainda for válida (emprestimo ativo ou pago)
            // Se o empréstimo foi totalmente pago, ele pode ter sumido do select se updateEmprestimosSelect() for chamado.
            // No entanto, updateEmprestimosList não chama updateEmprestimosSelect.
            // Mas precisamos garantir que a tela de pagamentos atualize os dados do empréstimo.
            
            // Força atualização da lista de empréstimos no select apenas se necessário, 
            // mas aqui queremos manter o foco.
            
            // Atualiza os detalhes na tela de pagamento
            carregarDetalhesPagamento();

            showAlert('Pagamento registrado com sucesso!');
        } catch (error) {
            console.error(error);
            showAlert(error.message, 'error');
        } finally {
            fecharModal();
        }
    }
    function calcularValorQuitacao(emp) {
        const pendentes = (emp.parcelasDetalhadas || []).filter((p) => p.status !== 'paga');
        const taxaDecimal = (emp.taxa || 0) / 100;
        const n = pendentes.length;
        if (n === 0) return 0;
        const vp = pendentes.reduce((sum, p, i) => {
            const k = i + 1;
            return sum + p.valor / Math.pow(1 + taxaDecimal, k);
        }, 0);
        return vp;
    }
    function simularAmortizacaoPreview() {
        if (!emprestimoSelecionado) return;
        const valor = parseFloat(dom.modalValorPagamento.value) || 0;
        const pendentes = (emprestimoSelecionado.parcelasDetalhadas || []).filter((p) => p.status !== 'paga');
        const totalOriginalRestante = pendentes.reduce((sum, p) => sum + p.valor, 0);
        const taxaDecimal = (emprestimoSelecionado.taxa || 0) / 100;
        const n = pendentes.length;
        const vp = calcularValorQuitacao(emprestimoSelecionado);
        const novoPrincipal = Math.max(vp - valor, 0);
        let novoValorParcela = 0;
        if (n > 0) {
            if (taxaDecimal === 0) {
                novoValorParcela = n > 0 ? novoPrincipal / n : 0;
            } else {
                const fator = (taxaDecimal * Math.pow(1 + taxaDecimal, n)) / (Math.pow(1 + taxaDecimal, n) - 1);
                novoValorParcela = novoPrincipal * fator;
            }
        }
        const novoSaldo = n > 0 ? novoValorParcela * n : 0;
        const economia = Math.max(totalOriginalRestante - (valor + novoSaldo), 0);
        const faltaParaQuitar = Math.max(vp - valor, 0);
        const el = document.getElementById('amortizacaoPreview');
        if (el) {
            el.innerHTML = `
                <div style="display:grid; grid-template-columns: repeat(2, 1fr); gap: 0.75rem;">
                    <div>
                        <div style="color: var(--text-secondary);">Valor para quitar hoje</div>
                        <div style="font-weight:600;">${formatMoney(vp)}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-secondary);">Falta para quitar</div>
                        <div style="font-weight:600; color: var(--accent-primary);">${formatMoney(faltaParaQuitar)}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-secondary);">Nova parcela estimada</div>
                        <div style="font-weight:600;">${formatMoney(novoValorParcela)}</div>
                    </div>
                    <div>
                        <div style="color: var(--text-secondary);">Economia estimada</div>
                        <div style="font-weight:600;">${formatMoney(economia)}</div>
                    </div>
                </div>
            `;
        }
    }
    // gráficos removidos
    function gerarRelatorioPDF() {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(20);
        doc.setTextColor(0, 255, 159);
        doc.text('Relatório de Empréstimos', 14, 20);
        doc.setFontSize(10);
        doc.setTextColor(100);
        doc.text(`Gerado em: ${new Date().toLocaleString('pt-BR')}`, 14, 28);
        doc.setFontSize(14);
        doc.setTextColor(0);
        doc.text('Resumo Geral', 14, 40);
        const totalEmprestado = state.emprestimos.reduce((sum, e) => sum + (e.valor || 0), 0);
        const totalReceber = state.emprestimos.filter((e) => e.status === 'ativo').reduce((sum, e) => sum + (e.saldoDevedor || 0), 0);
        doc.setFontSize(10);
        doc.text(`Total de Clientes: ${state.clientes.length}`, 14, 48);
        doc.text(`Total de Empréstimos: ${state.emprestimos.length}`, 14, 54);
        doc.text(`Total Emprestado: ${formatMoney(totalEmprestado)}`, 14, 60);
        doc.text(`Total a Receber: ${formatMoney(totalReceber)}`, 14, 66);
        const body = state.emprestimos.map((emp) => {
            const cliente = state.clientes.find((c) => c.id === emp.clienteId);
            return [
                cliente ? cliente.nome : 'N/A',
                `${formatMoney(emp.valor)}`,
                `${formatPercent(emp.taxa)}`,
                `${emp.parcelas}x`,
                `${formatMoney(emp.saldoDevedor)}`,
                emp.status.toUpperCase(),
            ];
        });
        doc.autoTable({
            startY: 75,
            head: [['Cliente', 'Valor', 'Taxa', 'Parcelas', 'Saldo', 'Status']],
            body,
            theme: 'grid',
            headStyles: { fillColor: [0, 255, 159], textColor: [0, 0, 0] },
            styles: { fontSize: 8 },
        });
        doc.save('relatorio-emprestimos.pdf');
    }

    function gerarCarnePDF() {
        if (!dom.emprestimoPagamento || !dom.emprestimoPagamento.value) {
            Toast.info('Selecione um empréstimo na aba Pagamentos.');
            return;
        }
        const emprestimo = state.emprestimos.find((e) => e.id === dom.emprestimoPagamento.value);
        if (!emprestimo) {
            Toast.error('Empréstimo não encontrado.');
            return;
        }
        const cliente = state.clientes.find((c) => c.id === emprestimo.clienteId);
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        doc.setFontSize(18);
        doc.text('CARNÊ DE PAGAMENTOS', 14, 20);
        doc.setFontSize(10);
        doc.text(`Cliente: ${cliente ? cliente.nome : 'N/A'}`, 14, 30);
        doc.text(`CPF: ${cliente ? cliente.cpf : '-'}`, 14, 36);
        doc.text(`Valor Emprestado: ${formatMoney(emprestimo.valor)}`, 14, 42);
        doc.text(`Taxa: ${formatPercent(emprestimo.taxa)} a.m.`, 14, 48);
        let y = 60;
        emprestimo.parcelasDetalhadas.forEach((parcela) => {
            if (y > 270) {
                doc.addPage();
                y = 20;
            }
            doc.setDrawColor(0, 255, 159);
            doc.setLineWidth(0.5);
            doc.rect(14, y, 180, 30);
            doc.setFontSize(12);
            doc.setFont(undefined, 'bold');
            doc.text(`Parcela ${parcela.numero}/${emprestimo.parcelas}`, 18, y + 8);
            doc.setFont(undefined, 'normal');
            doc.setFontSize(10);
            doc.text(`Vencimento: ${new Date(parcela.dataVencimento).toLocaleDateString('pt-BR')}`, 18, y + 15);
            doc.text(`Valor: ${formatMoney(parcela.valor)}`, 18, y + 22);
            if (parcela.status === 'paga') {
                doc.setTextColor(0, 200, 100);
                doc.text('✓ PAGA', 150, y + 15);
                doc.setTextColor(0);
            }
            y += 35;
        });
        const safeName = (cliente ? cliente.nome : 'cliente').replace(/\s+/g, '-');
        doc.save(`carne-${safeName}.pdf`);
    }
    function compararSistemas() {
        const compValorEl = document.getElementById('compValor');
        const compTaxaEl = document.getElementById('compTaxa');
        const compParcelasEl = document.getElementById('compParcelas');
        const simValorEl = document.getElementById('simValor');
        const simTaxaEl = document.getElementById('simTaxa');
        const simParcelasEl = document.getElementById('simParcelas');
        const valor = parseBRMoney((compValorEl && compValorEl.value) ? compValorEl.value : (simValorEl ? simValorEl.value : ''));
        const taxa = parseBRMoney((compTaxaEl && compTaxaEl.value) ? compTaxaEl.value : (simTaxaEl ? simTaxaEl.value : '')) / 100;
        const parcelas = parseInt((compParcelasEl && compParcelasEl.value) ? compParcelasEl.value : (simParcelasEl ? simParcelasEl.value : ''), 10);
        if (!valor || !taxa || !parcelas) {
            Toast.warning('Preencha os campos do simulador avançado.');
            return;
        }
        const parcelaPrice = (valor * (taxa * Math.pow(1 + taxa, parcelas))) / (Math.pow(1 + taxa, parcelas) - 1);
        const totalPrice = parcelaPrice * parcelas;
        const jurosPrice = totalPrice - valor;
        const amortizacaoSAC = valor / parcelas;
        let totalSAC = 0;
        const parcelasSAC = [];
        let saldoSAC = valor;
        for (let i = 0; i < parcelas; i += 1) {
            const jurosParcela = saldoSAC * taxa;
            const parcelaSAC = amortizacaoSAC + jurosParcela;
            parcelasSAC.push(parcelaSAC);
            totalSAC += parcelaSAC;
            saldoSAC -= amortizacaoSAC;
        }
        const jurosSAC = totalSAC - valor;
        const jurosMensal = valor * taxa;
        const totalAmericano = jurosMensal * parcelas + valor;
        const jurosAmericano = totalAmericano - valor;
        const html = `
            <div class="comparativo-grid">
                <div class="sistema-card" style="cursor: pointer; transition: transform 0.2s;" onclick="exibirParcelasSistema('PRICE', ${valor}, ${taxa}, ${parcelas})" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <div class="sistema-title">📊 Sistema PRICE</div>
                    <div class="result-row"><span class="result-label">Parcela Fixa</span><span class="result-value">${formatMoney(parcelaPrice)}</span></div>
                    <div class="result-row"><span class="result-label">Total a Pagar</span><span class="result-value">${formatMoney(totalPrice)}</span></div>
                    <div class="result-row"><span class="result-label">Total de Juros</span><span class="result-value">${formatMoney(jurosPrice)}</span></div>
                    <p class="muted" style="margin-top:1rem; font-size:0.85rem;">✓ Parcelas iguais<br>✓ Facilita o planejamento<br><br><small>(Clique para ver detalhes)</small></p>
                </div>
                <div class="sistema-card" style="cursor: pointer; transition: transform 0.2s;" onclick="exibirParcelasSistema('SAC', ${valor}, ${taxa}, ${parcelas})" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <div class="sistema-title">📉 Sistema SAC</div>
                    <div class="result-row"><span class="result-label">1ª Parcela</span><span class="result-value">${formatMoney(parcelasSAC[0])}</span></div>
                    <div class="result-row"><span class="result-label">Última Parcela</span><span class="result-value">${formatMoney(parcelasSAC[parcelas - 1])}</span></div>
                    <div class="result-row"><span class="result-label">Total a Pagar</span><span class="result-value">${formatMoney(totalSAC)}</span></div>
                    <div class="result-row"><span class="result-label">Total de Juros</span><span class="result-value">${formatMoney(jurosSAC)}</span></div>
                    <p class="muted" style="margin-top:1rem; font-size:0.85rem;">✓ Parcelas decrescentes<br>✓ Menor juros total<br><br><small>(Clique para ver detalhes)</small></p>
                </div>
                <div class="sistema-card" style="cursor: pointer; transition: transform 0.2s;" onclick="exibirParcelasSistema('AMERICANO', ${valor}, ${taxa}, ${parcelas})" onmouseover="this.style.transform='translateY(-5px)'" onmouseout="this.style.transform='translateY(0)'">
                    <div class="sistema-title">💵 Sistema AMERICANO</div>
                    <div class="result-row"><span class="result-label">Juros Mensais</span><span class="result-value">${formatMoney(jurosMensal)}</span></div>
                    <div class="result-row"><span class="result-label">Principal no Final</span><span class="result-value">${formatMoney(valor)}</span></div>
                    <div class="result-row"><span class="result-label">Total a Pagar</span><span class="result-value">${formatMoney(totalAmericano)}</span></div>
                    <div class="result-row"><span class="result-label">Total de Juros</span><span class="result-value">${formatMoney(jurosAmericano)}</span></div>
                    <p class="muted" style="margin-top:1rem; font-size:0.85rem;">✓ Só paga juros mensalmente<br>✓ Principal quitado no fim<br><br><small>(Clique para ver detalhes)</small></p>
                </div>
            </div>
            <div style="margin-top:2rem; padding:1rem; background: rgba(0,255,159,0.1); border-radius:8px; border:1px solid var(--accent-primary);">
                <strong style="color: var(--accent-primary);">💡 Melhor Opção:</strong>
                <p style="margin:0.5rem 0 0 0; color: var(--text-secondary);">
                    ${jurosSAC < jurosPrice ? `O Sistema SAC economiza ${formatMoney((jurosPrice - jurosSAC))} em juros.` : 'O Sistema PRICE oferece parcelas fixas e previsíveis.'}
                </p>
            </div>
            
            <div style="margin-top:1.5rem; padding:1rem; border:1px dashed var(--border); border-radius:8px;">
                <strong style="color: var(--text-primary);">🤔 Por que os juros totais são diferentes se a taxa é a mesma?</strong>
                <p style="margin-top:0.5rem; color: var(--text-secondary); font-size: 0.9rem; line-height: 1.5;">
                    A taxa de juros incide sempre sobre o <strong>Saldo Devedor</strong> (o quanto ainda falta pagar).
                </p>
                <ul style="margin-top:0.5rem; padding-left: 1.2rem; color: var(--text-secondary); font-size: 0.9rem;">
                    <li style="margin-bottom: 0.3rem;"><strong>SAC:</strong> Você amortiza (paga a dívida real) mais rápido no começo. O saldo cai rápido, gerando menos juros.</li>
                    <li style="margin-bottom: 0.3rem;"><strong>PRICE:</strong> As parcelas são fixas, mas no começo você paga muito juro e pouca dívida. O saldo demora a cair.</li>
                    <li><strong>AMERICANO:</strong> Você só paga os juros mensalmente e deixa a dívida toda para o final. O saldo nunca cai, gerando o máximo de juros possível.</li>
                </ul>
            </div>
        `;
        document.getElementById('comparativoSistemas').innerHTML = html;
    }
    function abrirModalCliente() {
        const modal = document.getElementById('modalNovoCliente');
        if (modal) modal.classList.add('active');
    }

    function fecharModalCliente() {
        const modal = document.getElementById('modalNovoCliente');
        if (modal) modal.classList.remove('active');
    }

    function abrirModalEmprestimo() {
        const modal = document.getElementById('modalNovoEmprestimo');
        if (modal) modal.classList.add('active');
    }

    function fecharModalEmprestimo() {
        const modal = document.getElementById('modalNovoEmprestimo');
        if (modal) modal.classList.remove('active');
    }

    function exibirParcelasSistema(sistema, valor, taxa, parcelas) {
        const titulo = document.getElementById('tituloDetalhesSistema');
        const conteudo = document.getElementById('conteudoDetalhesSistema');
        const modal = document.getElementById('modalDetalhesSistema');

        if (titulo) titulo.innerText = `Detalhamento - Sistema ${sistema}`;

        let html = `
            <table class="data-table">
                <thead>
                    <tr>
                        <th>#</th>
                        <th>Saldo Devedor</th>
                        <th>Amortização</th>
                        <th>Juros</th>
                        <th>Valor Parcela</th>
                    </tr>
                </thead>
                <tbody>
        `;

        let saldo = valor;
        let totalAmortizacao = 0;
        let totalJuros = 0;
        let totalPago = 0;

        const parcelaPrice = (valor * (taxa * Math.pow(1 + taxa, parcelas))) / (Math.pow(1 + taxa, parcelas) - 1);
        const amortizacaoSAC = valor / parcelas;

        for (let i = 1; i <= parcelas; i++) {
            let juros = saldo * taxa;
            let amortizacao = 0;
            let parcela = 0;

            if (sistema === 'PRICE') {
                parcela = parcelaPrice;
                // Ajuste na última parcela para zerar o saldo corretamente
                if (i === parcelas) {
                     parcela = saldo + juros; // Garante quitação
                     amortizacao = saldo;
                } else {
                     amortizacao = parcela - juros;
                }
            } else if (sistema === 'SAC') {
                amortizacao = amortizacaoSAC;
                // Ajuste na última parcela se necessário (arredondamentos)
                if (i === parcelas) amortizacao = saldo;
                parcela = amortizacao + juros;
            } else if (sistema === 'AMERICANO') {
                if (i === parcelas) {
                    amortizacao = valor;
                    parcela = valor + juros;
                } else {
                    amortizacao = 0;
                    parcela = juros;
                }
            }

            // Update totals
            totalAmortizacao += amortizacao;
            totalJuros += juros;
            totalPago += parcela;

            html += `
                <tr>
                    <td>${i}</td>
                    <td>${formatMoney(saldo)}</td>
                    <td>${formatMoney(amortizacao)}</td>
                    <td>${formatMoney(juros)}</td>
                    <td><strong>${formatMoney(parcela)}</strong></td>
                </tr>
            `;

            saldo -= amortizacao;
            if (saldo < 0.01) saldo = 0; 
        }

        html += `
                <tr style="background-color: var(--bg-card-hover); font-weight: bold;">
                    <td>TOTAL</td>
                    <td>-</td>
                    <td>${formatMoney(totalAmortizacao)}</td>
                    <td>${formatMoney(totalJuros)}</td>
                    <td>${formatMoney(totalPago)}</td>
                </tr>
                </tbody>
            </table>
        `;

        if (conteudo) conteudo.innerHTML = html;
        if (modal) modal.classList.add('active');
    }

    function fecharModalDetalhesSistema() {
        const modal = document.getElementById('modalDetalhesSistema');
        if (modal) modal.classList.remove('active');
    }

    window.abrirModalCliente = abrirModalCliente;
    window.fecharModalCliente = fecharModalCliente;
    window.abrirModalEmprestimo = abrirModalEmprestimo;
    window.fecharModalEmprestimo = fecharModalEmprestimo;
    window.exibirParcelasSistema = exibirParcelasSistema;
    function limparSimulador() {
        // Limpa todos os campos do simulador
        document.getElementById('simValor').value = '';
        document.getElementById('simTaxa').value = '';
        document.getElementById('simParcelas').value = '';

        // Limpa os resultados
        document.getElementById('simulatorResult').innerHTML = '';
        document.getElementById('comparativoSistemas').innerHTML = '';

        // Reseta a última simulação
        ultimaSimulacao = null;

        // Mostra mensagem de sucesso
        Toast.info('Simulador limpo! Preencha os campos para nova simulação.');
    }

    window.fecharModalDetalhesSistema = fecharModalDetalhesSistema;
    window.confirmarEmprestimoSimulado = confirmarEmprestimoSimulado;
    window.switchTab = switchTab;
    window.simular = simular;
    window.limparSimulador = limparSimulador;
    window.cadastrarCliente = cadastrarCliente;
    window.registrarEmprestimo = registrarEmprestimo;
    window.carregarDetalhesPagamento = carregarDetalhesPagamento;
    window.gerarRelatorioPDF = gerarRelatorioPDF;
    window.gerarCarnePDF = gerarCarnePDF;
    window.exportarDadosJSON = exportarDadosJSON;
    window.importarDadosJSON = importarDadosJSON;
    window.aplicarFiltros = aplicarFiltros;
    window.compararSistemas = compararSistemas;
    window.abrirModalAmortizacao = abrirModalAmortizacao;
    window.abrirModalPagamento = abrirModalPagamento;
    window.ajustarCamposPagamento = ajustarCamposPagamento;
    window.fecharModal = fecharModal;
    window.confirmarPagamento = confirmarPagamento;
    window.marcarComoPago = marcarComoPago;
    window.excluirEmprestimo = excluirEmprestimo;
})();
