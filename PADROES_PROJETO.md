# Padrões do projeto (condo-web)

## Textos de interface em português (PT-BR)

### Premissa: salvar, nunca guardar

Este projeto usa **português do Brasil (pt-BR)**, não português de Portugal (pt-PT).

- **Nunca** usar a palavra **guardar** (nem em maiúsculas) em textos de interface: botões, estados de carregamento, mensagens, títulos ou tooltips.
- **Sempre** usar **salvar** e derivações naturais em pt-BR quando o sentido for persistir dados ou preferências.

### Ação de persistir dados (botões e estados)

- **Sempre** usar **Salvar** nos rótulos de botão que gravam dados no servidor (ex.: `Salvar`, `Salvar alterações`, `Salvar nome`).
- **Sempre** usar **Salvando…** no estado de carregamento desse mesmo tipo de ação (pt-BR; evitar «a salvar…»).
- **Nunca** usar **Guardar**, **Guardar alterações**, **A guardar…** ou variantes.

Exemplos corretos:

- Botão: `Salvar`, `Salvar alterações`, `Salvar nome`
- Carregando: `Salvando…`

Para outras ações, alinhar o verbo ao significado (ex.: criar recurso novo → `Criar` / `Criando…`).

### Textos explicativos

Quando o verbo for “persistir escolha” em frases (não só no botão), usar **salvar** em vez de “guardar”, salvo exceções de domínio já estabelecidas em outro glossário do projeto.

## Datas na interface (pt-BR)

- **Sempre** exibir datas ao utilizador no formato **DD/MM/AAAA** (ex.: `11/04/2026`).
- Usar a função partilhada `formatDateDdMmYyyy` em `src/app/core/date-display.ts` (ou equivalente aprovado) para valores vindos da API em ISO (`YYYY-MM-DD` ou com hora), evitando mostrar `YYYY-MM-DD` em tabelas, cartões ou rótulos.
- **Valores enviados à API** podem continuar em **ISO** (`YYYY-MM-DD`) quando o contrato do backend assim exigir (ex.: query params, corpos JSON); a regra acima aplica-se à **apresentação** na UI.
- Campos nativos `type="date"` seguem o controlo do browser para edição; o valor em memória pode permanecer ISO; ao mostrar a mesma data fora do input (listas, resumos), preferir **DD/MM/AAAA**.
