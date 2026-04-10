# Padrões do projeto (condo-web)

## Textos de interface em português (PT-BR)

### Ação de persistir dados (botões e estados)

- **Sempre** usar **Salvar** nos rótulos de botão que gravam dados no servidor.
- **Sempre** usar **A salvar…** (ou **Salvando…**, se preferir no futuro de forma consistente) no estado de carregamento desse mesmo tipo de ação.
- **Nunca** usar **Guardar**, **Guardar alterações** ou **A guardar…** nestes contextos.

Exemplos corretos:

- Botão: `Salvar`, `Salvar nome`
- Carregando: `A salvar…`

Para outras ações, alinhar o verbo ao significado (ex.: criar recurso novo → `Criar` / `A criar…`).

### Textos explicativos

Quando o verbo for “persistir escolha” em frases (não só no botão), preferir **salvar** em vez de “guardar”, salvo exceções de domínio já estabelecidas noutro glossário.
