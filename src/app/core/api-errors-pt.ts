import { HttpErrorResponse } from '@angular/common/http';

const EXACT: Record<string, string> = {
  'Email already registered': 'Este e-mail já está cadastrado.',
  'Phone already registered': 'Este telefone já está cadastrado.',
  'Utilizador não encontrado.': 'Conta não encontrada.',
  'Senha atual incorreta.': 'Senha atual incorreta.',
  'Indique a senha atual para definir uma nova.':
    'Indique a senha atual para definir uma nova.',
  'Invalid credentials': 'Email ou senha incorretos.',
  'Número de telefone inválido.': 'Número de telefone inválido.',
  'Código inválido ou expirado.': 'Código inválido ou expirado.',
  'Sessão de recuperação inválida ou expirada.':
    'Etapa de recuperação inválida ou expirada. Solicite o código novamente.',
  'Recuperação por email indisponível neste ambiente.':
    'Recuperação por email indisponível neste ambiente.',
  'Recuperação por SMS indisponível neste ambiente.':
    'Recuperação por SMS indisponível neste ambiente.',
  'Indique o email.': 'Indique o email.',
  'Indique o mês/ano inicial e o mês/ano final do período, ou deixe os dois em branco.':
    'Indique o mês/ano inicial e o final do período, ou deixe os dois em branco.',
  'Período inválido. Use o formato AAAA-MM em ambos os campos.':
    'Período inválido. Use o formato AAAA-MM em ambos os campos.',
  'O mês/ano inicial não pode ser posterior ao mês/ano final.':
    'O mês/ano inicial não pode ser posterior ao mês/ano final.',
  'Regra de rateio inválida.': 'Regra de rateio inválida.',
  'Fundo deve ter rateio entre unidades (não use «sem repartição»).':
    'Fundo deve ter rateio entre unidades (não use «sem repartição»).',
  'O rateio selecionado não inclui nenhuma unidade.':
    'O rateio selecionado não inclui nenhuma unidade.',
  'Indique o débito mensal em centavos (valor inteiro ≥ 1).':
    'Indique o débito mensal (valor válido).',
  'Indique o total por unidade a arrecadar (centavos, ≥ 1).':
    'Indique o total por unidade a arrecadar.',
  'Indique em quantas mensalidades parcelar (≥ 1).':
    'Indique em quantas mensalidades parcelar.',
  'Indique o mês/ano da primeira mensalidade (AAAA-MM).':
    'Indique o mês/ano da primeira mensalidade.',
  'O valor total por unidade é baixo demais para o número de parcelas.':
    'O total por unidade é baixo demais para o número de parcelas.',
  'Regra de rateio em falta.': 'Regra de rateio em falta.',
  'Login por SMS indisponível neste ambiente.':
    'Login por SMS indisponível neste ambiente.',
  'Não foi possível contactar o serviço de SMS.':
    'Não foi possível contatar o serviço de SMS.',
  'O serviço de SMS recusou o envio.': 'O serviço de SMS recusou o envio.',
  Unauthorized: 'Não autorizado.',
  Forbidden: 'Acesso negado.',
  'Forbidden resource': 'Acesso negado.',
  'Not Found': 'Recurso não encontrado.',
  'Internal Server Error': 'Erro interno do servidor.',
  'Bad Request': 'Pedido inválido.',
  'Condominium not found or access denied':
    'Condomínio não encontrado ou sem permissão.',
  'Condominium not found': 'Condomínio não encontrado.',
  'Grouping not found': 'Agrupamento não encontrado.',
  'Grouping not found in this condominium':
    'Agrupamento não encontrado neste condomínio.',
  'Unit not found': 'Unidade não encontrada.',
  'Cannot delete the last grouping':
    'Não é possível excluir o último agrupamento.',
  'Email já está associado a outra ficha de pessoa.':
    'Email já está associado a outra ficha de pessoa.',
  'CPF já registado noutra ficha de pessoa.':
    'CPF já cadastrado em outra ficha de pessoa.',
  'Email ou CPF já registado noutra ficha de pessoa.':
    'E-mail ou CPF já cadastrado em outra ficha de pessoa.',
  'CEP inválido: são necessários 8 dígitos quando indicar endereço.':
    'CEP inválido: são necessários 8 dígitos quando indicar endereço.',
  'Endereço incompleto: logradouro, número, bairro, cidade e UF são obrigatórios com o CEP.':
    'Endereço incompleto: logradouro, número, bairro, cidade e UF são obrigatórios com o CEP.',
  'UF deve ter 2 letras.': 'UF deve ter 2 letras.',
  'Indique o nome completo para registar o endereço na ficha.':
    'Indique o nome completo para cadastrar o endereço na ficha.',
  'Expense transactions require an allocation rule':
    'Despesas exigem uma regra de rateio.',
  'Expense and investment transactions require an allocation rule':
    'Despesas e investimentos exigem uma regra de rateio.',
  'Invalid allocation rule': 'Regra de rateio inválida.',
  'Expense transactions require at least one unit in allocation':
    'Despesa exige pelo menos uma unidade no rateio.',
  'Expense and investment transactions require at least one unit in allocation':
    'Despesa e investimento exigem pelo menos uma unidade no rateio.',
  'No units in condominium for equal allocation':
    'Não há unidades no condomínio para ratear.',
  'No units in the selected groupings for allocation':
    'Os agrupamentos selecionados não têm unidades.',
  'unit_ids must not be empty': 'Selecione pelo menos uma unidade.',
  'grouping_ids must not be empty': 'Selecione pelo menos um agrupamento.',
  'One or more units not found in this condominium':
    'Uma ou mais unidades não pertencem a este condomínio.',
  'Excluded unit is not in this condominium':
    'Unidade excluída não pertence a este condomínio.',
  'One or more groupings not found in this condominium':
    'Um ou mais agrupamentos não existem neste condomínio.',
  'Fund not found': 'Fundo não encontrado.',
  'Transaction not found': 'Transação não encontrada.',
  'from and to query parameters are required (YYYY-MM-DD)':
    'Indique as datas inicial e final (AAAA-MM-DD).',
  'from and to must be YYYY-MM-DD': 'As datas devem estar no formato AAAA-MM-DD.',
  'Invalid date range': 'Intervalo de datas inválido.',
  'from must be before or equal to to':
    'A data inicial deve ser anterior ou igual à final.',
  'Invalid competenceYm': 'Competência inválida. Use o formato AAAA-MM.',
  'competenceYm query is required': 'Indique a competência (AAAA-MM).',
  'Cannot regenerate: there are paid charges for this month. Unlink payments first.':
    'Não é possível regenerar: existem cobranças já pagas neste mês. Desvincule os pagamentos primeiro.',
  'Charge is not open': 'Esta cobrança não está em aberto.',
  'Charge not found': 'Cobrança não encontrada.',
  'Income transaction has no allocation for this unit':
    'A receita não tem rateio para esta unidade.',
  'Income amount allocated to this unit does not match charge':
    'O valor da receita rateado para esta unidade não coincide com a cobrança.',
  'Transaction must be income': 'A transação tem de ser uma receita.',
  'Charge must be paid to generate a receipt':
    'Só é possível emitir o comprovante para cobranças já quitadas.',
  'No units in condominium for transparency report':
    'Não há unidades neste condomínio para gerar o relatório de transparência.',
};

function translateApiMessage(raw: string): string {
  const s = raw?.trim();
  if (!s) {
    return 'Ocorreu um erro.';
  }
  const mapped = EXACT[s];
  if (mapped) {
    return mapped;
  }
  const lower = s.toLowerCase();
  if (
    lower.includes('must be an email') ||
    lower.includes('must be a valid email')
  ) {
    return 'Introduza um endereço de email válido.';
  }
  if (
    lower.includes('should not be empty') ||
    lower.includes('must not be empty')
  ) {
    return 'Este campo não pode estar vazio.';
  }
  const minMatch = /longer than or equal to (\d+)/i.exec(s);
  if (minMatch) {
    return `É necessário pelo menos ${minMatch[1]} caracteres.`;
  }
  const maxMatch = /shorter than or equal to (\d+)/i.exec(s);
  if (maxMatch) {
    return `No máximo ${maxMatch[1]} caracteres.`;
  }
  if (lower.includes('must be a string')) {
    return 'Este valor deve ser texto.';
  }
  if (
    /must |should not |cannot |must not /i.test(s) &&
    /^[a-z0-9\s,'"._-]+$/i.test(s)
  ) {
    return 'Os dados enviados não são válidos. Confirme os campos e tente novamente.';
  }
  return s;
}

/** Quando `responseType: 'blob'`, erros HTTP podem vir como Blob com JSON no corpo. */
export async function translateHttpErrorMessageAsync(
  err: HttpErrorResponse,
  options: { network: string; default: string },
): Promise<string> {
  if (err.error instanceof Blob) {
    try {
      const text = await err.error.text();
      let parsed: unknown = text;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        /* corpo não é JSON */
      }
      const synthetic = new HttpErrorResponse({
        error: parsed,
        headers: err.headers,
        status: err.status,
        statusText: err.statusText,
        url: err.url ?? undefined,
      });
      return translateHttpErrorMessage(synthetic, options);
    } catch {
      /* ignora */
    }
  }
  return translateHttpErrorMessage(err, options);
}

export function translateHttpErrorMessage(
  err: HttpErrorResponse,
  options: { network: string; default: string },
): string {
  const raw = err.error;
  if (typeof raw === 'string' && raw.trim()) {
    return translateApiMessage(raw);
  }
  const body = raw as { message?: string | string[] } | undefined;
  if (body?.message) {
    const parts = Array.isArray(body.message)
      ? body.message
      : [body.message];
    return parts.map((p) => translateApiMessage(String(p))).join(' ');
  }
  if (err.status === 0) {
    return options.network;
  }
  return options.default;
}
