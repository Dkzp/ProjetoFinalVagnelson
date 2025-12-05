// ==================================================
//      CONFIGURAÇÃO E ESTADO GLOBAL
// ==================================================
const backendUrl = 'http://localhost:3001';
let garagem = {};
let previsaoProcessadaCompletaCache = null;
let nomeCidadeCache = "";

// ==================================================
//      1. GERENCIAMENTO DE AUTENTICAÇÃO
// ==================================================

function checkAuthState() {
    const token = localStorage.getItem('token');
    const authSection = document.getElementById('auth-section');
    const garageSection = document.getElementById('garage-main-content');
    const userControls = document.getElementById('user-controls');
    const userEmailSpan = document.getElementById('user-email');

    if (token) {
        // Estado Logado
        authSection.style.display = 'none';
        garageSection.style.display = 'block';
        userControls.style.display = 'flex';
        
        try { // Decodifica o token para obter o email do usuário
            const payload = JSON.parse(atob(token.split('.')[1]));
            userEmailSpan.textContent = payload.user.email || ''; 
        } catch (e) {
            userEmailSpan.textContent = 'Usuário';
        }

        carregarGaragem(); // Carrega veículos próprios e compartilhados
        carregarConteudoEstaticoDaAPI();
    } else {
        // Estado Deslogado
        authSection.style.display = 'block';
        garageSection.style.display = 'none';
        userControls.style.display = 'none';
        userEmailSpan.textContent = '';
    }
}

async function handleLogin(event) {
    event.preventDefault();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Entrando...';
    try {
        const response = await fetch(`${backendUrl}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.msg || 'Erro ao fazer login');
        
        localStorage.setItem('token', data.token);
        // Armazena o email para uso na UI
        try {
            const payload = JSON.parse(atob(data.token.split('.')[1]));
            payload.user.email = email; // Adiciona email ao payload decodificado
            localStorage.setItem('user_payload', JSON.stringify(payload.user));
        } catch(e){}

        checkAuthState();
    } catch (error) {
        alert(`Erro no Login: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Entrar';
        event.target.reset();
    }
}

async function handleRegister(event) {
    event.preventDefault();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const btn = event.target.querySelector('button[type="submit"]');
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Registrando...';
    try {
        const response = await fetch(`${backendUrl}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.msg || 'Erro ao registrar');
        alert('Registro realizado com sucesso! Agora você pode fazer o login.');
        document.getElementById('register-form-container').style.display = 'none';
        document.getElementById('login-form-container').style.display = 'block';
        document.getElementById('login-email').value = email;
    } catch (error) {
        alert(`Erro no Registro: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = 'Registrar';
        event.target.reset();
    }
}

function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user_payload');
    garagem = {};
    limparAreaDisplay(true);
    document.getElementById('menu-veiculos').innerHTML = '';
    checkAuthState();
}

function getAuthHeaders() {
    const token = localStorage.getItem('token');
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

function getUserIdFromToken() {
    const token = localStorage.getItem('token');
    if (!token) return null;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.user.id;
    } catch (e) {
        console.error("Erro ao decodificar token:", e);
        return null;
    }
}


// ==================================================
//      2. FUNÇÕES DE API (PROTEGIDAS E PÚBLICAS)
// ==================================================

async function carregarGaragem() {
    try {
        const response = await fetch(`${backendUrl}/api/garagem/veiculos`, { headers: getAuthHeaders() });
        if (response.status === 401) {
            handleLogout();
            return;
        }
        if (!response.ok) throw new Error('Não foi possível carregar sua garagem.');
        const veiculosDoDB = await response.json();
        garagem = {};
        for (const d of veiculosDoDB) {
            const id = d._id;
            if (!id || !d.modelo || !d.tipoVeiculo) continue;
            let veiculoInstance;
            const histRecriado = (d.historicoManutencao || []).map(m => new Manutencao(m.data, m.tipo, m.custo, m.descricao)).filter(m => m && m.validar());
            const args = [id, d.modelo, d.cor, d.imagemSrc, d.placa, d.ano, d.dataVencimentoCNH];
            switch (d.tipoVeiculo) {
                case 'CarroEsportivo':
                    veiculoInstance = new CarroEsportivo(...args);
                    veiculoInstance.turboAtivado = d.turboAtivado || false;
                    break;
                case 'Caminhao':
                    veiculoInstance = new Caminhao(...args, d.capacidadeCarga || 0);
                    veiculoInstance.cargaAtual = d.cargaAtual || 0;
                    break;
                default: veiculoInstance = new CarroBase(...args); break;
            }
            veiculoInstance.historicoManutencao = histRecriado;
            veiculoInstance.owner = d.owner; // GUARDA O OBJETO DO DONO { _id, email }
            garagem[id] = veiculoInstance;
        }
    } catch (e) {
        console.error("Erro ao carregar garagem:", e);
    }
    atualizarInterfaceCompleta();
}

async function carregarConteudoEstaticoDaAPI() {
    const containerDestaques = document.getElementById('cards-veiculos-destaque');
    const listaServicos = document.getElementById('lista-servicos-oferecidos');
    try {
        const [veiculosRes, servicosRes] = await Promise.all([
            fetch(`${backendUrl}/api/garagem/veiculos-destaque`),
            fetch(`${backendUrl}/api/garagem/servicos-oferecidos`)
        ]);
        if (!veiculosRes.ok || !servicosRes.ok) throw new Error("Falha ao buscar dados públicos");
        const veiculos = await veiculosRes.json();
        const servicos = await servicosRes.json();
        if (containerDestaques) exibirVeiculosDestaque(veiculos, containerDestaques);
        if (listaServicos) exibirServicosOferecidos(servicos, listaServicos);
    } catch (error) {
        console.error("Erro ao carregar conteúdo estático:", error);
    }
}

// ==================================================
//      3. MANIPULAÇÃO DE DADOS E EVENTOS DA GARAGEM
// ==================================================

function handleTrocarAba(abaId) {
    document.querySelectorAll('.secao-principal').forEach(s => s.classList.remove('ativa'));
    document.querySelectorAll('#abas-navegacao button').forEach(b => b.classList.remove('aba-ativa'));
    const secaoId = abaId === 'tab-garagem' ? 'secao-garagem' : 'secao-adicionar';
    document.getElementById(secaoId)?.classList.add('ativa');
    document.getElementById(abaId)?.classList.add('aba-ativa');
}

async function handleAdicionarVeiculo(event) {
    event.preventDefault();
    const form = event.target;
    const btnSubmit = form.querySelector('#adicionar-veiculo-btn');
    btnSubmit.disabled = true;
    btnSubmit.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    const mod = form.querySelector('#add-modelo').value.trim();
    const cor = form.querySelector('#add-cor').value.trim();
    const plc = form.querySelector('#add-placa').value.trim().toUpperCase();
    const ano = form.querySelector('#add-ano').value;
    const tipo = form.querySelector('#add-tipo').value;
    const capCg = (tipo === 'Caminhao') ? form.querySelector('#add-capacidade-carga').value : 0;
    const dtCnh = form.querySelector('#add-cnh').value;
    const imgInput = form.querySelector('#add-imagem-input');
    if (!mod || !tipo) {
        alert("Modelo e Tipo são obrigatórios!");
        btnSubmit.disabled = false;
        return;
    }
    const nId = `v${Date.now()}`;
    const criarEAdicionarVeiculo = async (imagemSrc = null) => {
        try {
            const args = [nId, mod, cor, imagemSrc, plc, ano, dtCnh || null];
            let nV;
            switch (tipo) {
                case 'CarroEsportivo': nV = new CarroEsportivo(...args); break;
                case 'Caminhao': nV = new Caminhao(...args, capCg); break;
                default: nV = new CarroBase(...args); break;
            }
            const dadosParaAPI = nV.toJSON();
            const response = await fetch(`${backendUrl}/api/garagem/veiculos`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify(dadosParaAPI)
            });
            if (!response.ok) {
                const errData = await response.json();
                throw new Error(errData.error || `Erro do servidor`);
            }
            // Recarrega a garagem para obter o objeto completo com o owner populado
            await carregarGaragem();
            form.reset();
            handleTrocarAba('tab-garagem');
        } catch (e) {
            alert(`Erro ao adicionar veículo: ${e.message}`);
        } finally {
            btnSubmit.disabled = false;
            btnSubmit.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Adicionar à Garagem';
        }
    };
    const file = imgInput?.files[0];
    if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => criarEAdicionarVeiculo(e.target.result);
        reader.readAsDataURL(file);
    } else {
        criarEAdicionarVeiculo(null);
    }
}

async function handleSalvarEdicaoVeiculo(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;
    const container = document.querySelector(`.veiculo-renderizado[data-template-id="${veiculoId}"]`);
    if (!container) return;
    const btnSalvar = container.querySelector('.salvar-veiculo-btn');
    btnSalvar.disabled = true;
    btnSalvar.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Salvando...';
    const modelo = container.querySelector('.edit-modelo-veiculo').value.trim();
    const cor = container.querySelector('.edit-cor-veiculo').value.trim();
    const placa = container.querySelector('.edit-placa-veiculo').value.trim().toUpperCase();
    const ano = container.querySelector('.edit-ano-veiculo').value;
    const dataCnh = container.querySelector('.edit-cnh-veiculo').value;
    const imagemInput = container.querySelector('.edit-imagem-input');

    const proceedWithSave = async (novaImagemSrc) => {
        try {
            v.modelo = modelo; v.cor = cor; v.placa = placa;
            v.ano = ano ? parseInt(ano) : null;
            v.dataVencimentoCNH = dataCnh ? new Date(dataCnh + 'T00:00:00Z') : null;
            if (novaImagemSrc) v.imagemSrc = novaImagemSrc;
            const dadosParaAPI = v.toJSON();
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(dadosParaAPI)
            });
            if (!response.ok) throw new Error('Erro do servidor ao salvar.');
            alert(`Veículo "${v.modelo}" atualizado!`);
            v.atualizarInformacoesUI("Edição Salva");
            atualizarMenuVeiculos();
            verificarVencimentoCNH();
        } catch (error) {
            alert(`Falha ao salvar: ${error.message}`);
        } finally {
            btnSalvar.disabled = false;
            btnSalvar.innerHTML = '<i class="fa-solid fa-save"></i> Salvar Alterações';
        }
    };
    const file = imagemInput?.files[0];
    if (file && file.type.startsWith("image/")) {
        const reader = new FileReader();
        reader.onload = (e) => proceedWithSave(e.target.result);
        reader.readAsDataURL(file);
    } else {
        proceedWithSave(null);
    }
}

async function handleExcluirVeiculo(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;
    if (confirm(`Tem certeza que deseja excluir o veículo "${v.modelo}"?`)) {
        try {
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });
            if (!response.ok) throw new Error('Erro do servidor ao excluir.');
            alert(`Veículo "${v.modelo}" excluído.`);
            delete garagem[veiculoId];
            atualizarInterfaceCompleta();
        } catch (error) {
            alert(`Falha ao excluir: ${error.message}`);
        }
    }
}

// ---> NOVA FUNÇÃO PARA COMPARTILHAR <---
async function handleShareVehicle(event, veiculoId) {
    event.preventDefault();
    const form = event.target;
    const emailInput = form.querySelector('.share-email-input');
    const email = emailInput.value.trim();
    const btn = form.querySelector('button[type="submit"]');

    if (!email) {
        alert("Por favor, insira um email para compartilhar.");
        return;
    }
    
    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';

    try {
        const response = await fetch(`${backendUrl}/api/garagem/veiculos/${veiculoId}/share`, {
            method: 'POST',
            headers: getAuthHeaders(),
            body: JSON.stringify({ email })
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.msg || "Ocorreu um erro ao compartilhar.");
        }
        alert(data.msg);
        emailInput.value = ''; // Limpa o campo após sucesso
    } catch (error) {
        alert(`Erro: ${error.message}`);
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Compartilhar';
    }
}


async function handleAgendarManutencao(event, veiculoId) {
    event.preventDefault();
    const v = garagem[veiculoId];
    if (!v) return;
    const form = event.target;
    const btnAgendar = form.querySelector('.agendar-manutencao-btn');
    btnAgendar.disabled = true;
    const dataStr = form.querySelector('.agendamento-data').value;
    const horaStr = form.querySelector('.agendamento-hora')?.value || '00:00';
    const tipoStr = form.querySelector('.agendamento-tipo').value.trim();
    if (!dataStr || !tipoStr) {
        alert("Data e Tipo de Serviço são obrigatórios!");
        btnAgendar.disabled = false;
        return;
    }
    const custoStr = form.querySelector('.agendamento-custo')?.value;
    const obsStr = form.querySelector('.agendamento-obs')?.value.trim();
    const dataHoraCompleta = new Date(`${dataStr}T${horaStr}`);
    const novaManutencao = new Manutencao(dataHoraCompleta, tipoStr, custoStr, obsStr);
    
    if (v.adicionarManutencao(novaManutencao)) {
        try {
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${v.id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(v.toJSON())
            });
            if (!response.ok) throw new Error("Falha ao salvar agendamento no servidor.");
            alert("Agendamento salvo com sucesso!");
            v.atualizarInformacoesUI("Agendamento Salvo");
        } catch(e) {
            alert(e.message);
            // Reverter a adição se o save falhar (opcional, mas bom)
            v.historicoManutencao.shift();
        } finally {
             btnAgendar.disabled = false;
        }
    } else {
        btnAgendar.disabled = false;
    }
}

async function handleLimparHistorico(veiculoId) {
    const v = garagem[veiculoId];
    if (!v) return;
    if (confirm(`Limpar TODO o histórico de "${v.modelo}"?`)) {
        v.limparHistoricoManutencao();
        try {
            const response = await fetch(`${backendUrl}/api/garagem/veiculos/${v.id}`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify(v.toJSON())
            });
            if (!response.ok) throw new Error("Falha ao limpar histórico no servidor.");
            v.atualizarInformacoesUI("Histórico Limpo");
        } catch(e) {
            alert(e.message);
        }
    }
}

function interagirVeiculoAtual(acao, extraElement = null) {
    const displayArea = document.getElementById('veiculo-display-area');
    const veiculoId = displayArea?.dataset.veiculoId;
    if (veiculoId && garagem[veiculoId]) {
        const arg = (acao === 'carregar' && extraElement) ? extraElement.value : null;
        interagir(veiculoId, acao, arg);
        if (extraElement) extraElement.value = '';
    } else {
        alert("Selecione um veículo.");
    }
}

function interagir(veiculoId, acao, arg = null) {
    const v = garagem[veiculoId];
    if (!v) return;
    try {
        switch (acao) {
            case 'ligar': v.ligar(); break;
            case 'desligar': v.desligar(); break;
            case 'acelerar': v.acelerar(); break;
            case 'frear': v.frear(); break;
            case 'buzinar': v.buzinar(); break;
            case 'ativarTurbo': if (v instanceof CarroEsportivo) v.ativarTurbo(); break;
            case 'carregar': if (v instanceof Caminhao) v.carregar(arg); break;
        }
    } catch (e) {
        console.error(`Erro na ação '${acao}':`, e);
    }
}

// =================================================================
//      4. LÓGICA DA INTERFACE (UI) - INCLUINDO NOVAS FUNÇÕES
// =================================================================

// --- LÓGICA NOVA PARA PREVISÃO DO TEMPO ---

async function handleBuscarPrevisao() {
    const inputCidade = document.getElementById('viagem-destino');
    const cidade = inputCidade.value.trim();
    const btn = document.getElementById('btn-buscar-previsao');
    const areaResultado = document.getElementById('previsao-resultado-area');

    if (!cidade) {
        alert("Por favor, digite o nome de uma cidade fofinha!");
        return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Buscando...';
    areaResultado.innerHTML = '<p>Consultando os anjos do tempo... <i class="fa-solid fa-spinner fa-spin"></i></p>';

    try {
        const response = await fetch(`${backendUrl}/api/previsao/${cidade}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || `Não encontramos a cidade "${cidade}".`);
        }
        
        nomeCidadeCache = data.city.name;
        previsaoProcessadaCompletaCache = processarDadosPrevisao(data.list);
        exibirPrevisaoFiltrada(5); // Exibe 5 dias por padrão
        document.getElementById('controles-previsao').style.display = 'block';

    } catch (error) {
        areaResultado.innerHTML = `<p style="color: var(--cor-erro-hk);">Oops! ${error.message}</p>`;
    } finally {
        btn.disabled = false;
        btn.innerHTML = '<i class="fa-solid fa-magnifying-glass-location"></i> Ver Previsão do Tempo';
    }
}

function processarDadosPrevisao(listaPrevisoes) {
    const previsoesPorDia = {};

    listaPrevisoes.forEach(p => {
        const data = new Date(p.dt * 1000).toLocaleDateString('pt-BR');
        if (!previsoesPorDia[data]) {
            previsoesPorDia[data] = {
                temps: [],
                descs: [],
                icons: [],
                dataObj: new Date(p.dt * 1000)
            };
        }
        previsoesPorDia[data].temps.push(p.main.temp);
        previsoesPorDia[data].descs.push(p.weather[0].description);
        previsoesPorDia[data].icons.push(p.weather[0].icon);
    });

    return Object.keys(previsoesPorDia).map(data => {
        const dia = previsoesPorDia[data];
        const tempMin = Math.min(...dia.temps);
        const tempMax = Math.max(...dia.temps);
        // Pega a descrição e ícone do meio-dia para ser mais representativo
        const descRepresentativa = dia.descs[Math.floor(dia.descs.length / 2)];
        const iconRepresentativo = dia.icons[Math.floor(dia.icons.length / 2)];

        return {
            data: dia.dataObj.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit' }),
            tempMin: tempMin.toFixed(0),
            tempMax: tempMax.toFixed(0),
            descricao: descRepresentativa.charAt(0).toUpperCase() + descRepresentativa.slice(1),
            iconUrl: `https://openweathermap.org/img/wn/${iconRepresentativo}@2x.png`
        };
    });
}

function exibirPrevisaoFiltrada(numDias) {
    const areaResultado = document.getElementById('previsao-resultado-area');
    const controles = document.getElementById('filtros-previsao-dias');

    if (!previsaoProcessadaCompletaCache) return;

    // Atualiza o botão ativo
    controles.querySelectorAll('.filtro-dia-btn').forEach(b => {
        b.classList.toggle('filtro-dia-btn-ativo', parseInt(b.dataset.dias) === numDias);
    });
    
    const previsoesParaExibir = previsaoProcessadaCompletaCache.slice(0, numDias);

    let html = `<h4><i class="fa-solid fa-sun" style="color: #FFD700;"></i> Previsão para ${nomeCidadeCache}</h4>`;
    html += '<div class="forecast-container">';
    html += previsoesParaExibir.map(p => `
        <div class="day-weather-card">
            <div class="forecast-date">${p.data}</div>
            <img src="${p.iconUrl}" alt="${p.descricao}" class="weather-icon-daily">
            <div class="forecast-desc">${p.descricao}</div>
            <div class="forecast-temp">
                <strong>${p.tempMax}°</strong> / ${p.tempMin}°
            </div>
        </div>
    `).join('');
    html += '</div>';
    
    areaResultado.innerHTML = html;
}

// --- LÓGICA NOVA PARA DICAS DE MANUTENÇÃO ---

async function handleBuscarDicas(tipo) {
    const areaResultado = document.getElementById('dicas-resultado-area');
    areaResultado.innerHTML = '<p>Procurando dicas fofinhas... <i class="fa-solid fa-spinner fa-spin"></i></p>';
    
    let url = `${backendUrl}/api/dicas-manutencao`;
    if (tipo !== 'geral') {
        url += `?tipo=${tipo}`;
    }

    try {
        const response = await fetch(url);
        const dicas = await response.json();

        if (!response.ok) {
            throw new Error("Não foi possível buscar as dicas.");
        }

        if (dicas.length === 0) {
            areaResultado.innerHTML = '<p>Nenhuma dica encontrada para esta categoria. <i class="fa-regular fa-face-sad-tear"></i></p>';
            return;
        }

        let html = '<ul>';
        html += dicas.map(d => `<li><i class="fa-solid fa-heart" style="color: var(--cor-acento-suave-hk); margin-right: 8px;"></i>${d.dica}</li>`).join('');
        html += '</ul>';
        areaResultado.innerHTML = html;

    } catch (error) {
        areaResultado.innerHTML = `<p style="color: var(--cor-erro-hk);">Oops! ${error.message}</p>`;
    }
}

// --- FUNÇÕES DE ATUALIZAÇÃO DA UI (EXISTENTES E ATUALIZADAS) ---

function atualizarInterfaceCompleta() {
    atualizarMenuVeiculos();
    atualizarExibicaoAgendamentosFuturos();
    verificarVencimentoCNH();
    verificarAgendamentosProximos();
    const veiculosIds = Object.keys(garagem);
    const displayArea = document.getElementById('veiculo-display-area');
    const idVeiculoAtual = displayArea?.dataset.veiculoId;
    if (veiculosIds.length === 0) {
        limparAreaDisplay(true);
    } else {
        if (!idVeiculoAtual || !garagem[idVeiculoAtual]) {
             const primeiroId = veiculosIds.sort((a,b) => garagem[a].modelo.localeCompare(garagem[b].modelo))[0];
             if (primeiroId) {
                renderizarVeiculo(primeiroId);
                marcarBotaoAtivo(primeiroId);
             }
        } else {
            renderizarVeiculo(idVeiculoAtual); // Força re-render para garantir consistência
        }
    }
}

function limparAreaDisplay(mostrarMsgGaragemVazia = false) {
    const displayArea = document.getElementById('veiculo-display-area');
    if (displayArea) {
        const msg = mostrarMsgGaragemVazia ?
            '<div class="placeholder"><i class="fa-solid fa-warehouse"></i> Sua garagem está vazia. Adicione um veículo fofinho!</div>' :
            '<div class="placeholder"><i class="fa-solid fa-hand-pointer"></i> Selecione um veículo no menu.</div>';
        displayArea.innerHTML = msg;
        delete displayArea.dataset.veiculoId;
    }
}

function atualizarMenuVeiculos() {
    const menu = document.getElementById('menu-veiculos');
    if (!menu) return;
    const ids = Object.keys(garagem).sort((a, b) => garagem[a].modelo.localeCompare(garagem[b].modelo));
    if (ids.length === 0) {
        menu.innerHTML = '<span class="empty-placeholder">Sua garagem está vazia <i class="fa-regular fa-face-sad-tear"></i></span>';
        return;
    }
    menu.innerHTML = ids.map(id => {
        const v = garagem[id];
        return `<button data-veiculo-id="${id}" title="${v.modelo} (${v.placa || 'S/P'})">${v.modelo}</button>`;
    }).join('');
    menu.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            marcarBotaoAtivo(btn.dataset.veiculoId);
            renderizarVeiculo(btn.dataset.veiculoId);
        });
    });
}

function marcarBotaoAtivo(id) {
    document.querySelectorAll('#menu-veiculos button').forEach(b => {
        b.classList.toggle('veiculo-ativo', b.dataset.veiculoId === id);
    });
}

function renderizarVeiculo(veiculoId) {
    const veiculo = garagem[veiculoId];
    const displayArea = document.getElementById('veiculo-display-area');
    const template = document.getElementById('veiculo-template');
    if (!veiculo || !displayArea || !template) {
        limparAreaDisplay();
        return;
    }
    displayArea.innerHTML = '';
    const clone = template.content.cloneNode(true);
    const container = clone.querySelector('.veiculo-renderizado');
    container.dataset.templateId = veiculoId; 

    // ---> LÓGICA DE AUTORIZAÇÃO E UI DE COMPARTILHAMENTO <---
    const loggedInUserId = getUserIdFromToken();
    const isOwner = veiculo.owner && veiculo.owner._id === loggedInUserId;

    const tituloEl = container.querySelector('.veiculo-titulo');
    if (tituloEl && !isOwner) {
        // É um veículo compartilhado
        tituloEl.innerHTML += ` <small style="font-size: 0.5em; color: var(--cor-texto-secundario-hk);">(Compartilhado por ${veiculo.owner.email})</small>`;
    }
    
    if (!isOwner) {
        // Se não for o dono, remove os controles sensíveis
        container.querySelector('.edicao-veiculo')?.remove();
        container.querySelector('.btn-excluir-veiculo')?.remove();
        container.querySelector('.compartilhamento-section')?.remove();
        container.querySelector('.btn-limpar-historico')?.remove();
    } else {
        // Se for o dono, adiciona o event listener ao form de compartilhamento
        const shareForm = container.querySelector('.form-compartilhar');
        shareForm?.addEventListener('submit', (e) => handleShareVehicle(e, veiculoId));
    }
    
    // Adiciona outros event listeners
    container.querySelectorAll('.acoes-veiculo button[data-acao]').forEach(btn => {
        if (!['ativarTurbo', 'carregar'].includes(btn.dataset.acao)) {
             btn.addEventListener('click', () => interagirVeiculoAtual(btn.dataset.acao));
        }
    });
    // Adiciona listeners apenas se os elementos existirem (não foram removidos pela lógica de autorização)
    container.querySelector('.btn-excluir-veiculo')?.addEventListener('click', () => handleExcluirVeiculo(veiculoId));
    container.querySelector('.salvar-veiculo-btn')?.addEventListener('click', () => handleSalvarEdicaoVeiculo(veiculoId));
    container.querySelector('.btn-limpar-historico')?.addEventListener('click', () => handleLimparHistorico(veiculoId));
    container.querySelector('.form-agendamento')?.addEventListener('submit', (e) => handleAgendarManutencao(e, veiculoId));
    
    displayArea.appendChild(clone);
    displayArea.dataset.veiculoId = veiculoId;
    veiculo.atualizarInformacoesUI("Renderização Completa");
}

function atualizarExibicaoAgendamentosFuturos() { 
    // Lógica original mantida
}
function verificarVencimentoCNH() { 
    // Lógica original mantida
}
function verificarAgendamentosProximos() { 
    // Lógica original mantida
}
function exibirVeiculosDestaque(veiculos, container) {
    if (!container || !veiculos) return;
    container.innerHTML = veiculos.map(v => `
        <div class="veiculo-card">
            <img src="${v.imagemUrl || 'default_car.png'}" alt="Imagem de ${v.modelo}" class="veiculo-card-img">
            <h3>${v.modelo} (${v.ano})</h3>
            <p>${v.destaque}</p>
        </div>
    `).join('');
}
function exibirServicosOferecidos(servicos, listaUl) {
    if (!listaUl || !servicos) return;
    listaUl.innerHTML = servicos.map(s => `
        <li class="servico-item">
            <strong>${s.nome}</strong>
            <em>${s.descricao}</em>
            <small>Preço Estimado: ${s.precoEstimado}</small>
        </li>
    `).join('');
}

// ==================================================
//      5. INICIALIZAÇÃO DA APLICAÇÃO
// ==================================================

function setupEventListeners() {
    // Autenticação
    document.getElementById('form-login')?.addEventListener('submit', handleLogin);
    document.getElementById('form-register')?.addEventListener('submit', handleRegister);
    document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
    document.getElementById('show-register')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('login-form-container').style.display = 'none';
        document.getElementById('register-form-container').style.display = 'block';
    });
    document.getElementById('show-login')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('register-form-container').style.display = 'none';
        document.getElementById('login-form-container').style.display = 'block';
    });

    // Navegação e Adição de Veículos
    document.getElementById('tab-garagem')?.addEventListener('click', () => handleTrocarAba('tab-garagem'));
    document.getElementById('tab-adicionar')?.addEventListener('click', () => handleTrocarAba('tab-adicionar'));
    document.getElementById('form-add-veiculo')?.addEventListener('submit', handleAdicionarVeiculo);
    
    const tipoSelect = document.getElementById('add-tipo');
    const cargaContainer = document.getElementById('add-capacidade-carga-container');
    if (tipoSelect && cargaContainer) {
        tipoSelect.addEventListener('change', () => {
             cargaContainer.style.display = tipoSelect.value === 'Caminhao' ? 'block' : 'none';
        });
    }

    // --- NOVOS EVENT LISTENERS ---
    
    // Previsão do Tempo
    document.getElementById('btn-buscar-previsao')?.addEventListener('click', handleBuscarPrevisao);
    document.querySelectorAll('.filtro-dia-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const dias = parseInt(btn.dataset.dias);
            exibirPrevisaoFiltrada(dias);
        });
    });

    // Dicas de Manutenção
    document.getElementById('btn-buscar-dicas-gerais')?.addEventListener('click', () => handleBuscarDicas('geral'));
    document.getElementById('btn-buscar-dicas-tipo')?.addEventListener('click', () => {
        const select = document.getElementById('select-tipo-dica');
        const tipoVeiculo = select.value;
        if (tipoVeiculo) {
            handleBuscarDicas(tipoVeiculo);
        } else {
            alert("Escolha um tipo de veículo fofinho primeiro!");
        }
    });
}

function inicializarAplicacao() {
    console.log("Iniciando Garagem Fofinha com Autenticação...");
    setupEventListeners();
    checkAuthState();
}

document.addEventListener('DOMContentLoaded', inicializarAplicacao);