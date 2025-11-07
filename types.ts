export interface Transaction {
  id: string;
  date: string;
  description: string;
  amount: number;
  type: 'debit' | 'credit';
  reconciliationStatus?: 'posted' | 'unposted';
  notes?: string;
}

export interface Account {
  id: string;
  code: string;
  name: string;
  type: string;
  isBankAccount?: boolean;
}

export interface ReconciledTransaction {
    id: string; // Composite key: date-desc-amount-type
    period: string; // YYYY-MM
    bankAccountId: string;
    journalEntryId: string;
    originalDate: string;
    originalDescription: string;
    originalAmount: number;
    originalType: 'debit' | 'credit';
}

export interface Session {
  id: string;
  period: string; // YYYY-MM
  timestamp: number;
  accounts: Account[];
  journalEntries: JournalEntry[];
  reconciledTransactions: ReconciledTransaction[];
}

export interface JournalLine {
  id: string; // For React keys
  accountId: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface JournalEntry {
  id: string;
  date: string;
  description: string; // Narration
  refNo?: string;
  lines: JournalLine[];
  notes?: string;
}