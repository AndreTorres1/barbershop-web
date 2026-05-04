# The Sharp Cut

Demo de uma plataforma digital para barbearias premium, pensada para mostrar a futuros clientes como um estúdio pode gerir marcações, equipa e operação num só produto.

Este projeto não é apenas um website institucional. É uma demo funcional de um sistema com:

- site público da barbearia
- experiência de marcação online
- painel de administração para gerir barbeiros
- onboarding privado para novos barbeiros
- área privada de cada barbeiro para agenda e pedidos

## Ideia do projeto

Muitas barbearias dependem de WhatsApp, chamadas ou mensagens soltas para marcar serviços, gerir horários e distribuir trabalho entre barbeiros. Isso cria fricção, atrasos e falta de controlo.

O objetivo desta demo é mostrar uma alternativa mais profissional:

- o cliente marca online
- o administrador gere a equipa
- cada barbeiro controla a própria disponibilidade
- o negócio ganha mais organização e melhor apresentação

## O que esta demo mostra

### 1. Site público

O lado público da barbearia foi desenhado para passar uma imagem premium e converter visitas em marcações.

Inclui:

- landing page da marca
- secções de serviços e experiência
- fluxo de booking
- escolha de barbeiro
- seleção de datas e horas disponíveis

### 2. Admin dashboard

O painel de administração foi pensado como um backoffice simples e limpo.

O admin consegue:

- ver a operação num dashboard
- criar barbeiros
- editar barbeiros
- remover ou restaurar barbeiros
- acompanhar reservas
- acompanhar notificações
- copiar o link privado de onboarding de cada barbeiro

### 3. Onboarding de barbeiros

Quando um novo barbeiro entra na equipa:

- o admin cria o perfil
- o sistema gera um link de convite
- o barbeiro abre esse link
- cria a própria conta
- passa a entrar na área privada com email e password

Isto permite mostrar ao cliente final um fluxo mais realista do que simplesmente “adicionar utilizadores” manualmente.

### 4. Área privada do barbeiro

Cada barbeiro tem o seu próprio espaço para trabalho diário.

Pode:

- consultar pedidos pendentes
- aceitar ou rejeitar reservas
- adicionar notas de decisão
- gerir dias de trabalho
- definir hora de início e fim
- configurar pausas
- bloquear datas
- bloquear horários específicos
- marcar férias ou indisponibilidades

## Valor para um cliente barbeiro

Esta demo ajuda um potencial cliente a visualizar um produto com valor comercial real.

Benefícios que a demo comunica:

- imagem mais profissional para a marca
- menos dependência de mensagens manuais
- melhor organização da equipa
- maior controlo da disponibilidade
- fluxo de onboarding para novos barbeiros
- base para crescer para um SaaS ou produto interno

## Fluxo principal da demo

### Fluxo do administrador

1. entra no dashboard privado
2. cria ou edita um barbeiro
3. obtém o link de onboarding
4. envia esse link ao barbeiro
5. acompanha reservas, estados e operação

### Fluxo do barbeiro

1. recebe o link de convite
2. cria a conta
3. entra na área privada
4. gere agenda e disponibilidade
5. responde aos pedidos de reserva

### Fluxo do cliente final

1. entra no site público
2. escolhe serviço
3. escolhe barbeiro
4. escolhe data e hora disponíveis
5. envia o pedido de marcação

## Áreas principais

- site público: `http://localhost:3000/`
- admin: `http://localhost:3000/admin`
- barber access hub: `http://localhost:3000/barber`
- onboarding de barbeiro: `http://localhost:3000/barber/onboard/:barberId`
- portal privado de barbeiro: `http://localhost:3000/barber/:barberId`

Se a porta `3000` estiver ocupada, podes arrancar noutra, por exemplo `3001`.

## Como correr a demo localmente

```bash
ADMIN_TOKEN=your-secret-token npm start
```

Exemplos:

```bash
npm start
PORT=3001 npm start
ADMIN_TOKEN=adminRWRE PORT=3001 npm start
```

Se `ADMIN_TOKEN` não estiver definido, o projeto usa `change-me-admin-token`.

## Credenciais e seed de demonstração

Token de admin usado na demo:

- `adminRWRE`

Access codes atualmente existentes:

- `Ricardo Fonseca`: `RICARDO-2026`
- `Tomás Alves`: `TOMAS-2026`
- `Miguel Costa`: `MIGUEL-2026`
- `André Goncalves`: `ANDREG-67AC68`

## O que está implementado

- website público com identidade premium
- booking com disponibilidade dinâmica
- painel de administração com CRUD de barbeiros
- onboarding privado para novos barbeiros
- login de barbeiros
- gestão de agenda por barbeiro
- reservas com estados
- notificações registadas no sistema
- persistência local com SQLite e snapshots JSON

## Estrutura do projeto

### Frontend

- `index.html` -> site público e booking
- `admin.html` -> painel de administração
- `barber.html` -> acesso e área privada do barbeiro
- `barber-onboarding.html` -> criação de conta do barbeiro

### Backend

- `server.js`

### Dados

- `data/barbershop.sqlite`
- `data/barbers.json`
- `data/reservations.json`
- `data/notifications.json`

## API principal

### Pública

- `GET /api/health`
- `GET /api/barbers`
- `GET /api/barbers/list`
- `GET /api/booking/options`
- `POST /api/bookings`

### Admin

- `GET /api/admin/barbers`
- `GET /api/admin/dashboard`
- `GET /api/admin/reservations`
- `GET /api/admin/notifications`
- `POST /api/admin/barbers`
- `PATCH /api/admin/barbers/:id`
- `DELETE /api/admin/barbers/:id`
- `PATCH /api/admin/barbers/:id/restore`

### Barbeiro

- `GET /api/barber/:id/invite`
- `POST /api/barber/:id/account-setup`
- `POST /api/barber/login`
- `GET /api/barber/:id`
- `POST /api/barber/:id/logout`
- `GET /api/barber/:id/reservations`
- `PATCH /api/barber/:id/reservations/:reservationId`
- `PATCH /api/barber/:id/availability`
- `GET /api/barber/:id/notifications`

## O que um futuro cliente pode imaginar a partir desta demo

Esta base já mostra bem o conceito, mas também pode evoluir para:

- SMS ou email automáticos
- calendário visual mais avançado
- pagamentos online
- multi-loja
- métricas de faturação
- gestão de equipa mais completa
- autenticação mais robusta

## Porque este projeto é útil em contexto comercial

Se estiveres a apresentar esta demo a uma barbearia, o cliente consegue perceber rapidamente:

- como a marca ficaria online
- como as marcações seriam geridas
- como novos barbeiros poderiam ser adicionados
- como cada barbeiro controlaria a própria agenda
- como o negócio poderia parecer mais organizado e premium

## Nota final

Este projeto foi preparado como demo funcional e base de portefólio. A ideia principal é comunicar produto, fluxo e potencial comercial de forma clara, sem deixar de ter uma base técnica real por trás.
