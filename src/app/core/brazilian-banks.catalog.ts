/** Banco com código COMPE (quando aplicável) para referência. */
export type BrazilianBankEntry = {
  /** Identificador estável (slug). */
  id: string;
  /** Nome exibido e gravado em `bank_name`. */
  name: string;
  /** Código COMPE (3 dígitos). */
  compe: string;
  /** Arquivo SVG em `@edusites/bancos-brasil` (quando existir). */
  logoSlug?: string;
  /** Fundo do monograma quando não há logo. */
  brandColor: string;
  /** Cor do texto do monograma. */
  brandTextColor: string;
  /** Sigla no círculo (1–3 letras). */
  initials: string;
};

const RAW: Omit<BrazilianBankEntry, 'id'>[] = [
  {
    name: 'Agibank',
    compe: '121',
    logoSlug: 'agibank',
    brandColor: '#00A651',
    brandTextColor: '#ffffff',
    initials: 'AG',
  },
  {
    name: 'Asaas',
    compe: '461',
    logoSlug: 'asaas',
    brandColor: '#0030B9',
    brandTextColor: '#ffffff',
    initials: 'AS',
  },
  {
    name: 'Banco BMG',
    compe: '318',
    logoSlug: 'bmg',
    brandColor: '#F68D2E',
    brandTextColor: '#1a1a1a',
    initials: 'BM',
  },
  {
    name: 'Banco BS2',
    compe: '218',
    logoSlug: 'bs2',
    brandColor: '#142032',
    brandTextColor: '#ffffff',
    initials: 'B2',
  },
  {
    name: 'Banco do Brasil',
    compe: '001',
    logoSlug: 'bancodobrasil',
    brandColor: '#003882',
    brandTextColor: '#FFCC29',
    initials: 'BB',
  },
  {
    name: 'Banco do Nordeste',
    compe: '004',
    brandColor: '#E30613',
    brandTextColor: '#ffffff',
    initials: 'BN',
  },
  {
    name: 'Banco Modal',
    compe: '746',
    brandColor: '#1D1D1B',
    brandTextColor: '#ffffff',
    initials: 'MO',
  },
  {
    name: 'Banco Original',
    compe: '212',
    logoSlug: 'original',
    brandColor: '#00A857',
    brandTextColor: '#ffffff',
    initials: 'OR',
  },
  {
    name: 'Banco PAN',
    compe: '623',
    logoSlug: 'pan',
    brandColor: '#00ADEF',
    brandTextColor: '#ffffff',
    initials: 'PN',
  },
  {
    name: 'Banco Rendimento',
    compe: '633',
    brandColor: '#003B71',
    brandTextColor: '#ffffff',
    initials: 'RE',
  },
  {
    name: 'Banco Safra',
    compe: '422',
    logoSlug: 'safra',
    brandColor: '#151D43',
    brandTextColor: '#C3AC6C',
    initials: 'SF',
  },
  {
    name: 'Banco Sofisa',
    compe: '637',
    brandColor: '#005EB8',
    brandTextColor: '#ffffff',
    initials: 'SO',
  },
  {
    name: 'Banco Topázio',
    compe: '082',
    brandColor: '#00A3E0',
    brandTextColor: '#ffffff',
    initials: 'TP',
  },
  {
    name: 'Banco Votorantim',
    compe: '655',
    logoSlug: 'bv',
    brandColor: '#004B8D',
    brandTextColor: '#ffffff',
    initials: 'BV',
  },
  {
    name: 'Banestes',
    compe: '021',
    brandColor: '#00539F',
    brandTextColor: '#ffffff',
    initials: 'BE',
  },
  {
    name: 'Banpará',
    compe: '003',
    brandColor: '#005EB8',
    brandTextColor: '#ffffff',
    initials: 'BP',
  },
  {
    name: 'Banrisul',
    compe: '041',
    brandColor: '#007DC6',
    brandTextColor: '#ffffff',
    initials: 'BR',
  },
  {
    name: 'Bradesco',
    compe: '237',
    logoSlug: 'bradesco',
    brandColor: '#CC092F',
    brandTextColor: '#ffffff',
    initials: 'BD',
  },
  {
    name: 'BRB',
    compe: '070',
    brandColor: '#005EB8',
    brandTextColor: '#ffffff',
    initials: 'RB',
  },
  {
    name: 'BTG Pactual',
    compe: '208',
    logoSlug: 'btg',
    brandColor: '#001E62',
    brandTextColor: '#ffffff',
    initials: 'BT',
  },
  {
    name: 'C6 Bank',
    compe: '336',
    logoSlug: 'c6',
    brandColor: '#121212',
    brandTextColor: '#ffffff',
    initials: 'C6',
  },
  {
    name: 'Caixa Econômica Federal',
    compe: '104',
    logoSlug: 'caixa',
    brandColor: '#0066B3',
    brandTextColor: '#ffffff',
    initials: 'CE',
  },
  {
    name: 'Citibank',
    compe: '745',
    brandColor: '#003B70',
    brandTextColor: '#ffffff',
    initials: 'CI',
  },
  {
    name: 'Cora',
    compe: '403',
    logoSlug: 'cora',
    brandColor: '#FE3E6D',
    brandTextColor: '#ffffff',
    initials: 'CO',
  },
  {
    name: 'Credisan',
    compe: '089',
    brandColor: '#006837',
    brandTextColor: '#ffffff',
    initials: 'CR',
  },
  {
    name: 'Daycoval',
    compe: '707',
    brandColor: '#003A70',
    brandTextColor: '#ffffff',
    initials: 'DY',
  },
  {
    name: 'Digio',
    compe: '335',
    logoSlug: 'digio',
    brandColor: '#00275C',
    brandTextColor: '#ffffff',
    initials: 'DG',
  },
  {
    name: 'Efí (Gerencianet)',
    compe: '364',
    logoSlug: 'efibank',
    brandColor: '#00A868',
    brandTextColor: '#ffffff',
    initials: 'EF',
  },
  {
    name: 'Inter',
    compe: '077',
    logoSlug: 'inter',
    brandColor: '#FF7A00',
    brandTextColor: '#ffffff',
    initials: 'IN',
  },
  {
    name: 'Itaú Unibanco',
    compe: '341',
    logoSlug: 'itau',
    brandColor: '#EC7000',
    brandTextColor: '#ffffff',
    initials: 'IT',
  },
  {
    name: 'Mercado Pago',
    compe: '323',
    logoSlug: 'mercadopago',
    brandColor: '#00BCFF',
    brandTextColor: '#0A0080',
    initials: 'MP',
  },
  {
    name: 'Neon',
    compe: '735',
    logoSlug: 'neon',
    brandColor: '#161C3E',
    brandTextColor: '#01C4E0',
    initials: 'NE',
  },
  {
    name: 'Nubank',
    compe: '260',
    logoSlug: 'nubank',
    brandColor: '#820AD1',
    brandTextColor: '#ffffff',
    initials: 'NU',
  },
  {
    name: 'PagBank',
    compe: '290',
    logoSlug: 'pagbank',
    brandColor: '#42A936',
    brandTextColor: '#000000',
    initials: 'PG',
  },
  {
    name: 'PicPay',
    compe: '380',
    logoSlug: 'picpay',
    brandColor: '#21C25E',
    brandTextColor: '#ffffff',
    initials: 'PP',
  },
  {
    name: 'Santander',
    compe: '033',
    logoSlug: 'santander',
    brandColor: '#EC0000',
    brandTextColor: '#ffffff',
    initials: 'ST',
  },
  {
    name: 'Sicoob',
    compe: '756',
    logoSlug: 'sicoob',
    brandColor: '#003B43',
    brandTextColor: '#B8D335',
    initials: 'SC',
  },
  {
    name: 'Sicredi',
    compe: '748',
    logoSlug: 'sicredi',
    brandColor: '#3FA110',
    brandTextColor: '#ffffff',
    initials: 'SI',
  },
  {
    name: 'Stone',
    compe: '197',
    logoSlug: 'stone',
    brandColor: '#00A868',
    brandTextColor: '#ffffff',
    initials: 'SN',
  },
  {
    name: 'SumUp',
    compe: '404',
    brandColor: '#000000',
    brandTextColor: '#ffffff',
    initials: 'SU',
  },
  {
    name: 'Unicred',
    compe: '136',
    brandColor: '#00594C',
    brandTextColor: '#ffffff',
    initials: 'UC',
  },
  {
    name: 'Will Bank',
    compe: '280',
    brandColor: '#FFD100',
    brandTextColor: '#1a1a1a',
    initials: 'WB',
  },
  {
    name: 'XP',
    compe: '102',
    logoSlug: 'xp',
    brandColor: '#000000',
    brandTextColor: '#ffffff',
    initials: 'XP',
  },
];

function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

/** Lista fixa de bancos atuantes no Brasil, em ordem alfabética (pt-BR). */
export const BRAZILIAN_BANKS: readonly BrazilianBankEntry[] = Object.freeze(
  RAW.map((b) => ({ ...b, id: slugify(b.name) })).sort((a, b) =>
    a.name.localeCompare(b.name, 'pt-BR'),
  ),
);
