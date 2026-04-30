# Padrões do projeto (condo-web)

## Textos de interface em português (PT-BR)

Todo o texto voltado ao **usuário** final deve seguir **português do Brasil (pt-BR)**, não português de Portugal (pt-PT). Exemplos de vocabulário:

| Evitar (pt-PT / mistura) | Usar (pt-BR) |
|--------------------------|--------------|
| registo, registado       | registro, registrado |
| A carregar… | Carregando… |
| A enviar… / A pesquisar… | Enviando… / Pesquisando… |
| utilizador               | usuário |
| email (rótulo pode manter) | E-mail (preferível em rótulos formais) |

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

### Ação de obter arquivo no dispositivo (botões)

- **Sempre** usar **Download** nos rótulos de botão que enviam um arquivo para o dispositivo do usuário (anexos, PDFs, etc.).
- **Nunca** usar **Descarregar** nesses rótulos (vocabulário de pt-PT; na UI do projeto fica **Download**).
- Em frases explicativas pode usar **fazer o download**, **download** (substantivo) ou **baixar**, conforme soar natural em pt-BR; os botões mantêm o rótulo curto **Download**.

### Textos explicativos

Quando o verbo for “persistir escolha” em frases (não só no botão), usar **salvar** em vez de “guardar”, salvo exceções de domínio já estabelecidas em outro glossário do projeto.

## Datas na interface (pt-BR)

- **Sempre** exibir datas ao usuário no formato **dd/mm/aaaa** (ex.: `11/04/2026`).
- Usar a função compartilhada `formatDateDdMmYyyy` em `src/app/core/date-display.ts` (ou equivalente aprovado) para valores vindos da API em ISO (`YYYY-MM-DD` ou com hora), evitando mostrar `YYYY-MM-DD` em tabelas, cartões ou rótulos.
- Quando a UI mostrar **data e hora** (ex.: expiração de convite, eventos), usar o formato **`dd/mm/aaaa HH:MM`** em **24 horas** (ex.: `21/04/2026 00:28`), via `formatDateTimeDdMmYyyyHhMm` no mesmo ficheiro. **Não** usar o `DatePipe` com `'short'` ou locale en-US (evita `M/D/yy` e `AM/PM`).
- **Valores enviados à API** podem continuar em **ISO** (`YYYY-MM-DD` ou instante completo) quando o contrato do backend assim exigir; as regras acima aplicam-se à **apresentação** na UI.
- Campos nativos `type="date"` seguem o controle do navegador para edição; o valor em memória pode permanecer ISO; ao mostrar a mesma data fora do input (listas, resumos), preferir **dd/mm/aaaa**.

## Áreas do painel (condomínio)

- **Comunicação** (`…/comunicacao`): informativos com anexos e envio por e-mail/SMS; no SaaS a feature continua com a chave `documents`.
- **Pautas/Atas** (`…/planejamento`): pautas eletrônicas, votação e PDF de ata por pauta.
