export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  accountCode: string;
  notes?: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
}

export interface Session {
  id: string;
  name: string;
  timestamp: number;
  transactions: Transaction[];
  accounts: Account[];
}

export interface CashbookEntry {
  id: string;
  date: string;
  reference: string;
  description: string;
  accountId: string;
  debit: number;
  credit: number;
  bankAccountId: string;
  department: string;
  taxCode: string;
  vendor: string;
  memoReference: string;
  notes?: string;
}