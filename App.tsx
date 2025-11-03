


import React, { useState, useEffect, useMemo, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { Transaction, Account, Session, CashbookEntry } from './types';
import { UploadIcon, TrashIcon, DownloadIcon, PlusIcon, PencilIcon, CheckIcon, XIcon, SparklesIcon, ArrowUpDownIcon, SaveIcon, BookOpenIcon, ClipboardListIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, BrainIcon } from './components/icons';
import { getApiKey } from './utils';

declare var XLSX: any; // Declare the XLSX global from the script tag in index.html

const DAILY_AI_LIMIT = 10;
const USAGE_STORAGE_KEY = 'aiUsageTracker';

// --- HOOKS ---

const useAiLimiter = () => {
    const [usage, setUsage] = useState({ count: 0, limit: DAILY_AI_LIMIT });
    const isLimitReached = useMemo(() => usage.count >= usage.limit, [usage]);

    useEffect(() => {
        const today = new Date().toISOString().split('T')[0];
        try {
            const stored = localStorage.getItem(USAGE_STORAGE_KEY);
            if (stored) {
                const parsed = JSON.parse(stored);
                if (parsed.date === today) {
                    setUsage(prev => ({ ...prev, count: parsed.count }));
                } else {
                    localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
                }
            } else {
                localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ date: today, count: 0 }));
            }
        } catch (e) {
            console.error("Failed to read AI usage from storage", e);
        }
    }, []);

    const tryAiFeature = (): boolean => {
        const today = new Date().toISOString().split('T')[0];
        try {
            const stored = JSON.parse(localStorage.getItem(USAGE_STORAGE_KEY) || JSON.stringify({ date: today, count: 0 }));
            let currentCount = stored.count;
            if (stored.date !== today) {
                currentCount = 0; // Reset on new day
            }

            if (currentCount >= DAILY_AI_LIMIT) {
                setUsage(prev => ({...prev, count: currentCount}));
                alert(`You have reached your daily limit of ${DAILY_AI_LIMIT} AI actions. Please try again tomorrow.`);
                return false; // Not allowed
            }
            
            const newCount = currentCount + 1;
            localStorage.setItem(USAGE_STORAGE_KEY, JSON.stringify({ date: today, count: newCount }));
            setUsage(prev => ({ ...prev, count: newCount }));
            return true; // Allowed
        } catch (e) {
            console.error("AI Limiter Error:", e);
            alert("An error occurred while managing your AI usage limit.");
            return false;
        }
    };

    return { usage, isLimitReached, tryAiFeature };
};


// Helper function to convert File to a GoogleGenerativeAI.Part
const fileToGenerativePart = async (file: File) => {
    const base64EncodedDataPromise = new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(file);
    });
    return {
        inlineData: {
            data: await base64EncodedDataPromise,
            mimeType: file.type
        }
    };
};

// Creates a consistent, unique key for a transaction to persist its note
const createTransactionKey = (tx: { date: string, description: string, amount: number, type: 'debit' | 'credit' }): string => {
    const normalizedDescription = tx.description.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 50);
    return `tx_note::${tx.date}_${normalizedDescription}_${tx.amount}_${tx.type}`;
};

type AppState = 'init' | 'upload' | 'analyzing' | 'error';
type AppView = 'statement' | 'cashbook';
type SortDirection = 'asc' | 'desc';
type SortKey = keyof Transaction | null;
type CashbookSortKey = 'date' | 'description' | 'amount' | 'accountId' | 'notes';

const initialFilters = {
    searchQuery: '',
    filterAccountCode: 'all',
    filterType: 'all' as 'all' | 'debit' | 'credit',
    filterReconciled: 'all',
    dateRange: { start: '', end: '' },
    amountRange: { min: '', max: '' },
};


const SearchableAccountSelect = ({ accounts, value, onChange, placeholder = "Select account..." }: { accounts: Account[], value: string, onChange: (code: string) => void, placeholder?: string }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const selectedAccount = accounts.find(a => a.code === value);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
                setIsOpen(false);
                setSearchTerm('');
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const filteredAccounts = useMemo(() => {
        if (!searchTerm) return accounts;
        const lowerSearchTerm = searchTerm.toLowerCase();
        return accounts.filter(acc =>
            acc.name.toLowerCase().includes(lowerSearchTerm) ||
            acc.code.toLowerCase().includes(lowerSearchTerm)
        );
    }, [searchTerm, accounts]);

    const handleSelect = (code: string) => {
        onChange(code);
        setIsOpen(false);
        setSearchTerm('');
    };
    
    const displayValue = isOpen ? searchTerm : (selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : '');

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div className="border border-slate-300 rounded-md focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 flex items-center bg-white" >
                <input
                    type="text"
                    className="w-full border-0 focus:ring-0 p-1.5 text-sm rounded-md"
                    placeholder={placeholder}
                    value={displayValue}
                    onChange={(e) => {
                        setSearchTerm(e.target.value);
                        if (!isOpen) setIsOpen(true);
                    }}
                    onFocus={() => {
                        setIsOpen(true);
                        setSearchTerm('');
                    }}
                    onClick={() => setIsOpen(true)}
                />
                 <button type="button" onClick={() => setIsOpen(!isOpen)} className="p-1 text-slate-400 hover:text-slate-600">
                    <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
                 </button>
            </div>
            {isOpen && (
                <ul className="absolute z-30 w-full mt-1 bg-white border border-slate-300 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {filteredAccounts.length > 0 ? filteredAccounts.map(acc => (
                        <li key={acc.id} onClick={() => handleSelect(acc.code)} className="px-3 py-2 text-sm hover:bg-indigo-50 cursor-pointer">
                           {acc.code} - {acc.name}
                        </li>
                    )) : <li className="px-3 py-2 text-sm text-slate-500">No accounts found.</li>}
                </ul>
            )}
        </div>
    );
};


const ChartOfAccountsModal = ({ currentAccounts, onSave, onClose }: { currentAccounts: Account[], onSave: (accounts: Account[]) => void, onClose: () => void }) => {
    const [accounts, setAccounts] = useState<Account[]>([]);
    const [pastedText, setPastedText] = useState('');
    const [errors, setErrors] = useState<{ [id: string]: { code?: string, name?: string, type?: string } }>({});
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setAccounts(JSON.parse(JSON.stringify(currentAccounts)));
    }, [currentAccounts]);

    const handleUpdateAccount = (id: string, field: keyof Account, value: string) => {
        setAccounts(prev => prev.map(acc => acc.id === id ? { ...acc, [field]: value } : acc));
        if(errors[id]) {
            setErrors(prev => {
                const newErrors = {...prev};
                delete newErrors[id][field as keyof typeof newErrors[string]];
                if(Object.keys(newErrors[id]).length === 0) delete newErrors[id];
                return newErrors;
            })
        }
    };

    const handleAddAccount = () => {
        const newAccount: Account = { id: Date.now().toString(), code: '', name: '', type: '' };
        setAccounts(prev => [...prev, newAccount]);
    };

    const handleDeleteAccount = (id: string) => {
        if (accounts.find(a => a.id === id)?.code === '0000') {
            alert("The 'Uncategorized' account cannot be deleted.");
            return;
        }
        setAccounts(prev => prev.filter(acc => acc.id !== id));
    };

    const parseAndImportData = (data: (string | number)[][]) => {
        const importedAccounts = data.filter(row => row.length >= 3 && row[0] && row[1] && row[2]).map((row, index) => ({
            id: `imported-${Date.now()}-${index}`,
            code: String(row[0]).trim(),
            name: String(row[1]).trim(),
            type: String(row[2]).trim(),
        }));
        
        const uniqueImported = importedAccounts.filter(imp => !accounts.some(exist => exist.code === imp.code));
        setAccounts(prev => [...prev, ...uniqueImported]);
        alert(`${uniqueImported.length} new accounts imported.`);
    };
    
    const handleValidateAndSave = () => {
        const newErrors: { [id: string]: { code?: string, name?: string, type?: string } } = {};
        const codeSet = new Set<string>();

        accounts.forEach(acc => {
            const accErrors: { code?: string, name?: string, type?: string } = {};

            // Code validation
            if (!acc.code.trim()) {
                accErrors.code = 'Code is required.';
            } else if (acc.code !== '0000' && acc.code.startsWith('0')) {
                accErrors.code = 'Leading zeros are not allowed.';
            } else if (!/^[a-zA-Z0-9-]+$/.test(acc.code)) {
                accErrors.code = 'Only letters, numbers, and hyphens are allowed.';
            } else if (codeSet.has(acc.code)) {
                accErrors.code = 'Code must be unique.';
            }
            codeSet.add(acc.code);

            // Name and Type validation
            if (!acc.name.trim()) accErrors.name = 'Name is required.';
            if (!acc.type.trim()) accErrors.type = 'Type is required.';

            if (Object.keys(accErrors).length > 0) {
                newErrors[acc.id] = accErrors;
            }
        });

        setErrors(newErrors);

        if (Object.keys(newErrors).length === 0) {
            onSave(accounts);
        } else {
            alert('Please fix the validation errors before saving.');
        }
    };


    const handleProcessPastedText = () => {
        const rows = pastedText.trim().split('\n').map(row => row.split(/[\t,]/));
        parseAndImportData(rows);
        setPastedText('');
    };
    
    const handleFileImport = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = new Uint8Array(e.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[sheetName];
                const jsonData: (string|number)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                const firstRow = (jsonData[0] || []).map(h => String(h).toLowerCase());
                if (firstRow.includes('code') || firstRow.includes('name') || firstRow.includes('type')) {
                    jsonData.shift();
                }
                parseAndImportData(jsonData);
            } catch (error) {
                console.error("Error parsing file:", error);
                alert("Failed to parse the file. Please ensure it's a valid CSV or Excel file with at least 3 columns (Code, Name, Type).");
            } finally {
                if (fileInputRef.current) fileInputRef.current.value = '';
            }
        };
        reader.readAsArrayBuffer(file);
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[90vh] flex flex-col transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b">
                    <h3 className="text-xl font-semibold text-slate-800">Manage Chart of Accounts</h3>
                </div>
                <div className="flex-grow p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div className="md:col-span-2">
                         <div className="overflow-auto h-[calc(80vh-200px)] border rounded-lg">
                            <table className="w-full text-sm text-left text-slate-500">
                                <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0">
                                    <tr>
                                        <th className="px-4 py-3">Code</th>
                                        <th className="px-4 py-3">Name</th>
                                        <th className="px-4 py-3">Type</th>
                                        <th className="px-4 py-3">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {accounts.map(acc => (
                                        <tr key={acc.id} className="bg-white border-b hover:bg-slate-50">
                                            <td className="px-4 py-2 align-top">
                                                <input type="text" value={acc.code} onChange={e => handleUpdateAccount(acc.id, 'code', e.target.value)} className={`w-full px-2 py-2 bg-transparent border-0 focus:ring-1 focus:ring-indigo-500 rounded-md ${errors[acc.id]?.code ? 'ring-2 ring-red-500' : ''}`} />
                                                {errors[acc.id]?.code && <p className="text-xs text-red-600 mt-1 px-2">{errors[acc.id]?.code}</p>}
                                            </td>
                                            <td className="px-4 py-2 align-top">
                                                <input type="text" value={acc.name} onChange={e => handleUpdateAccount(acc.id, 'name', e.target.value)} className={`w-full px-2 py-2 bg-transparent border-0 focus:ring-1 focus:ring-indigo-500 rounded-md ${errors[acc.id]?.name ? 'ring-2 ring-red-500' : ''}`} />
                                                {errors[acc.id]?.name && <p className="text-xs text-red-600 mt-1 px-2">{errors[acc.id]?.name}</p>}
                                            </td>
                                            <td className="px-4 py-2 align-top">
                                                <input type="text" value={acc.type} onChange={e => handleUpdateAccount(acc.id, 'type', e.target.value)} className={`w-full px-2 py-2 bg-transparent border-0 focus:ring-1 focus:ring-indigo-500 rounded-md ${errors[acc.id]?.type ? 'ring-2 ring-red-500' : ''}`} />
                                                {errors[acc.id]?.type && <p className="text-xs text-red-600 mt-1 px-2">{errors[acc.id]?.type}</p>}
                                            </td>
                                            <td className="px-4 py-2 align-top"><button onClick={() => handleDeleteAccount(acc.id)} className="p-2 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button></td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                         </div>
                         <button onClick={handleAddAccount} className="mt-4 text-sm font-semibold text-indigo-600 hover:text-indigo-800 flex items-center gap-1"><PlusIcon className="w-4 h-4"/> Add Account</button>
                    </div>
                    <div className="space-y-6 bg-slate-50 p-4 rounded-lg">
                        <h4 className="font-semibold text-slate-700">Import Accounts</h4>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Paste from spreadsheet</label>
                            <textarea value={pastedText} onChange={e => setPastedText(e.target.value)} rows={5} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Paste tab or comma separated values (Code, Name, Type)"></textarea>
                            <button onClick={handleProcessPastedText} disabled={!pastedText.trim()} className="mt-2 w-full bg-indigo-500 text-white text-sm font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-indigo-600 disabled:bg-slate-400">Import from Text</button>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Upload file</label>
                             <input ref={fileInputRef} type="file" onChange={handleFileImport} accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                            <p className="text-xs text-slate-500 mt-1">Upload a CSV or Excel file with columns: Code, Name, Type.</p>
                        </div>
                    </div>
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg border-t">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={handleValidateAndSave} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save Changes</button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const NoteEditModal = ({ transaction, onSave, onClose }: { transaction: Transaction | null, onSave: (txId: string, note: string) => void, onClose: () => void }) => {
    const [noteText, setNoteText] = useState('');
    const textAreaRef = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (transaction) {
            setNoteText(transaction.notes || '');
            setTimeout(() => textAreaRef.current?.focus(), 100);
        }
    }, [transaction]);
    
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    if (!transaction) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4 transition-opacity duration-300" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">Edit Note</h3>
                    <p className="text-sm text-slate-500 mb-4 break-words" title={transaction.description}>For: <span className="font-medium text-slate-700">{transaction.description}</span></p>
                    <textarea ref={textAreaRef} value={noteText} onChange={(e) => setNoteText(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base" rows={6} placeholder="Add your note here..." />
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={() => onSave(transaction.id, noteText)} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save Note</button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const SaveSessionModal = ({ onSave, onClose }: { onSave: (name: string) => void, onClose: () => void }) => {
    const [name, setName] = useState(() => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        return `Session ${year}-${month}-${day} ${hours}:${minutes}`;
    });
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        setTimeout(() => {
            inputRef.current?.focus();
            inputRef.current?.select();
        }, 100);
    }, []);

    const handleSave = () => { if (name.trim()) onSave(name.trim()); };
    
    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-sm transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-4">Save Session</h3>
                    <input ref={inputRef} type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyUp={(e) => e.key === 'Enter' && handleSave()} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 text-base" placeholder="e.g., Q1 2024 Statement" />
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={handleSave} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save</button>
                </div>
            </div>
             <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const CashbookEditModal = ({ entry, accounts, onSave, onClose, onOpenLinkModal, onUnlink, transactions }: { entry: CashbookEntry, accounts: Account[], onSave: (entry: CashbookEntry) => void, onClose: () => void, onOpenLinkModal: () => void, onUnlink: () => void, transactions: Transaction[] }) => {
    const [editedEntry, setEditedEntry] = useState<CashbookEntry>(entry);
    const currencyFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

    useEffect(() => {
        setEditedEntry(entry);
    }, [entry]);

    const handleChange = (field: keyof CashbookEntry, value: string | number) => {
        setEditedEntry(prev => ({ ...prev, [field]: value }));
    };

    const linkedTx = useMemo(() => {
        if (!editedEntry.linkedTransactionId) return null;
        return transactions.find(t => t.id === editedEntry.linkedTransactionId);
    }, [editedEntry.linkedTransactionId, transactions]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b">
                    <h3 className="text-xl font-semibold text-slate-800">Edit Cashbook Entry</h3>
                </div>
                <div className="p-6 max-h-[70vh] overflow-y-auto">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                        {Object.entries(editedEntry).filter(([key]) => key !== 'id' && key !== 'linkedTransactionId').map(([key, value]) => {
                             const field = key as keyof CashbookEntry;
                             return (
                                <div key={field} className={field === 'description' || field === 'notes' ? 'sm:col-span-2' : ''}>
                                    <label className="block font-medium text-slate-600 capitalize mb-1">{field.replace(/([A-Z])/g, ' $1')}</label>
                                    {field === 'accountId' ? (
                                        <SearchableAccountSelect accounts={accounts} value={value as string} onChange={code => handleChange(field, code)} />
                                    ) : field === 'notes' || field === 'description' ? (
                                        <textarea value={value as string} onChange={e => handleChange(field, e.target.value)} rows={field === 'notes' ? 4 : 2} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" />
                                    ) : (
                                        <input type={ (field === 'debit' || field === 'credit') ? 'number' : field === 'date' ? 'date' : 'text' }
                                            value={value as any}
                                            onChange={e => handleChange(field, e.target.value)}
                                            className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" />
                                    )}
                                </div>
                            )
                        })}
                         <div className="sm:col-span-2">
                            <label className="block font-medium text-slate-600 mb-1">Linked Transaction</label>
                            {linkedTx ? (
                                <div className="flex items-center justify-between p-2 pl-3 bg-slate-100 rounded-md text-sm">
                                    <div className="flex-grow min-w-0">
                                        <p className="text-slate-800 truncate font-medium" title={linkedTx.description}>
                                            {linkedTx.date} - {linkedTx.description}
                                        </p>
                                        <p className={`text-xs font-semibold ${linkedTx.type === 'debit' ? 'text-red-500' : 'text-green-500'}`}>
                                            {currencyFormatter.format(linkedTx.amount)} ({linkedTx.type})
                                        </p>
                                    </div>
                                    <button onClick={onUnlink} className="font-semibold text-red-600 hover:text-red-800 px-3 py-1 flex-shrink-0 ml-2">Unlink</button>
                                </div>
                            ) : (
                                <button onClick={onOpenLinkModal} className="w-full text-center py-2 px-4 border-2 border-dashed border-slate-300 rounded-md hover:border-teal-500 hover:text-teal-600 text-slate-500 transition-colors">
                                    Link to Statement Transaction
                                </button>
                            )}
                        </div>
                    </div>
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg border-t">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={() => onSave(editedEntry)} className="bg-teal-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-teal-700 transition-colors">Save Changes</button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const CashbookNoteModal = ({ entry, onSave, onClose }: { entry: CashbookEntry | null, onSave: (entryId: string, note: string) => void, onClose: () => void }) => {
    const [noteText, setNoteText] = useState('');
    
    useEffect(() => {
        if (entry) setNoteText(entry.notes || '');
    }, [entry]);

    if (!entry) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-lg transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6">
                    <h3 className="text-lg font-semibold text-slate-800 mb-2">Note</h3>
                    <p className="text-sm text-slate-500 mb-4 break-words" title={entry.description}>For: <span className="font-medium text-slate-700">{entry.description}</span></p>
                    <textarea value={noteText} onChange={(e) => setNoteText(e.target.value)} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" rows={8} placeholder="Add your note here..."></textarea>
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center space-x-3 rounded-b-lg">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Cancel</button>
                    <button onClick={() => onSave(entry.id, noteText)} className="bg-teal-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-teal-700 transition-colors">Save Note</button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const FilterPanel = ({
    isOpen,
    onClose,
    filters,
    setFilters,
    accounts,
    clearFilters
}: {
    isOpen: boolean;
    onClose: () => void;
    filters: typeof initialFilters;
    setFilters: React.Dispatch<React.SetStateAction<typeof initialFilters>>;
    accounts: Account[];
    clearFilters: () => void;
}) => {
    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, [name]: value }));
    };

    const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, dateRange: { ...prev.dateRange, [name]: value } }));
    };

    const handleAmountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const { name, value } = e.target;
        setFilters(prev => ({ ...prev, amountRange: { ...prev.amountRange, [name]: value } }));
    };

    return (
        <>
            <div className={`fixed inset-0 bg-black bg-opacity-50 z-40 transition-opacity ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`} onClick={onClose}></div>
            <div className={`fixed top-0 right-0 bottom-0 w-full max-w-sm bg-white shadow-lg z-50 transform transition-transform duration-300 ease-in-out ${isOpen ? 'translate-x-0' : 'translate-x-full'} flex flex-col`}>
                <div className="flex items-center justify-between p-4 border-b">
                    <h3 className="text-lg font-semibold text-slate-800">Filter Transactions</h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100">
                        <XIcon className="w-5 h-5" />
                    </button>
                </div>
                <div className="flex-grow p-6 overflow-y-auto space-y-6">
                    <div>
                        <label htmlFor="searchQuery" className="block text-sm font-medium text-slate-600 mb-1">Search description</label>
                        <input id="searchQuery" name="searchQuery" type="text" placeholder="e.g., Office Supplies" value={filters.searchQuery} onChange={handleInputChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm" />
                    </div>
                     <div>
                        <label htmlFor="filterAccountCode" className="block text-sm font-medium text-slate-600 mb-1">Account</label>
                        <select id="filterAccountCode" name="filterAccountCode" value={filters.filterAccountCode} onChange={handleInputChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm">
                            <option value="all">All Accounts</option>
                            {accounts.map(a => <option key={a.id} value={a.code}>{a.code} - {a.name}</option>)}
                        </select>
                    </div>
                     <div>
                        <label htmlFor="filterType" className="block text-sm font-medium text-slate-600 mb-1">Transaction Type</label>
                        <select id="filterType" name="filterType" value={filters.filterType} onChange={handleInputChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm">
                            <option value="all">All Types</option>
                            <option value="debit">Debit</option>
                            <option value="credit">Credit</option>
                        </select>
                    </div>
                    <div>
                        <label htmlFor="filterReconciled" className="block text-sm font-medium text-slate-600 mb-1">Reconciliation Status</label>
                        <select id="filterReconciled" name="filterReconciled" value={filters.filterReconciled} onChange={handleInputChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm">
                            <option value="all">All Statuses</option>
                            <option value="reconciled">Reconciled</option>
                            <option value="unreconciled">Unreconciled</option>
                        </select>
                    </div>
                    <fieldset className="border-t pt-4">
                        <legend className="text-sm font-medium text-slate-600 mb-2">Date Range</legend>
                        <div className="flex items-center gap-2">
                           <input id="start" name="start" type="date" value={filters.dateRange.start} onChange={handleDateChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm" title="Start Date" />
                            <span className="text-slate-500">to</span>
                           <input id="end" name="end" type="date" value={filters.dateRange.end} onChange={handleDateChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm" title="End Date" />
                        </div>
                    </fieldset>
                    <fieldset className="border-t pt-4">
                        <legend className="text-sm font-medium text-slate-600 mb-2">Amount Range</legend>
                        <div className="flex items-center gap-2">
                           <input id="min" name="min" type="number" placeholder="Min amount" value={filters.amountRange.min} onChange={handleAmountChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm" />
                            <span className="text-slate-500">to</span>
                           <input id="max" name="max" type="number" placeholder="Max amount" value={filters.amountRange.max} onChange={handleAmountChange} className="w-full border border-slate-300 rounded-md px-3 py-2 focus:ring-2 focus:ring-indigo-500 text-sm" />
                        </div>
                    </fieldset>
                </div>
                <div className="p-4 bg-slate-50 border-t flex items-center justify-end gap-3">
                    <button onClick={clearFilters} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200">Clear All</button>
                    <button onClick={onClose} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Done</button>
                </div>
            </div>
        </>
    );
};

const LinkTransactionModal = ({ unreconciledTransactions, onLink, onClose }: { unreconciledTransactions: Transaction[], onLink: (txId: string) => void, onClose: () => void }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const currencyFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

    const filtered = useMemo(() => {
        if (!searchTerm) return unreconciledTransactions;
        const lower = searchTerm.toLowerCase();
        return unreconciledTransactions.filter(tx => 
            tx.description.toLowerCase().includes(lower) ||
            tx.date.includes(lower) ||
            String(tx.amount).includes(lower)
        );
    }, [searchTerm, unreconciledTransactions]);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[60] p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-4 border-b flex-shrink-0">
                    <h3 className="text-xl font-semibold text-slate-800">Link to Statement Transaction</h3>
                    <input type="text" placeholder="Search by date, description, amount..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="mt-2 w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" />
                </div>
                <div className="flex-grow p-1 sm:p-4 overflow-y-auto">
                    {filtered.length > 0 ? (
                        <ul className="divide-y divide-slate-200">
                            {filtered.map(tx => (
                                <li key={tx.id} className="flex items-center justify-between p-3 hover:bg-slate-50 flex-wrap gap-2">
                                    <div className="flex-grow">
                                        <p className="font-medium text-slate-800">{tx.date} - <span className="text-slate-600">{tx.description}</span></p>
                                        <p className={`text-sm font-semibold ${tx.type === 'debit' ? 'text-red-500' : 'text-green-500'}`}>{currencyFormatter.format(tx.amount)} ({tx.type})</p>
                                    </div>
                                    <button onClick={() => onLink(tx.id)} className="bg-teal-600 text-white font-semibold text-sm px-4 py-1.5 rounded-lg shadow-sm hover:bg-teal-700 transition-colors flex-shrink-0">Select</button>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <div className="h-full flex items-center justify-center">
                            <p className="text-center text-slate-500">No unreconciled transactions found{searchTerm && ' for your search'}.</p>
                        </div>
                    )}
                </div>
                <div className="bg-slate-50 px-4 py-3 flex justify-end items-center rounded-b-lg border-t flex-shrink-0">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 px-4 py-2 rounded-md hover:bg-slate-200">Close</button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};

const TextImproverModal = ({ isOpen, onClose }: { isOpen: boolean, onClose: () => void }) => {
    const [inputText, setInputText] = useState('');
    const [outputText, setOutputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    const handleGenerate = async () => {
        if (!inputText.trim()) return;
        setIsLoading(true);
        setError('');
        setOutputText('');
        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const prompt = `You are an AI assistant that refines unstructured financial text into a short, clear narration. Your goal is to create a concise sentence that captures the key information, such as the purpose of the payment, the recipient (bank/vendor), and the payer.
Example Input: FCMB PREMIUM FEDOZ NIGERIA LIMITED-FIPIBPSF ₦ 224,035.00
Example Output: Premium Payment to FCMB by FEDOZ LTD.
Now, process the following text:
"${inputText}"`;
            
            const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
            setOutputText(response.text.trim());
        } catch (err) {
            console.error("Text Improver Error:", err);
            setError(err instanceof Error ? err.message : "An unknown error occurred.");
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleCopy = () => {
        navigator.clipboard.writeText(outputText);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4" onClick={onClose}>
            <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b flex items-center justify-between">
                    <h3 className="text-xl font-semibold text-slate-800 flex items-center gap-2"><SparklesIcon className="w-6 h-6 text-indigo-500" /> AI Text Assistant</h3>
                    <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"><XIcon className="w-5 h-5" /></button>
                </div>
                <div className="p-6">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Unstructured Text</label>
                            <textarea value={inputText} onChange={e => setInputText(e.target.value)} rows={6} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-sm" placeholder="Paste your text here..."></textarea>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-600 mb-1">Generated Narration</label>
                             <div className="w-full h-[152px] p-2 border border-slate-300 rounded-md bg-slate-50 text-sm relative">
                                {isLoading ? (
                                    <div className="flex items-center justify-center h-full"><div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div></div>
                                ) : (
                                    <>
                                        <p className="whitespace-pre-wrap">{outputText}</p>
                                        {outputText && (
                                            <button onClick={handleCopy} className="absolute top-2 right-2 p-1.5 bg-white border rounded-md text-slate-500 hover:bg-slate-100 hover:text-indigo-600">
                                                {isCopied ? <CheckIcon className="w-4 h-4 text-green-600" /> : <ClipboardListIcon className="w-4 h-4" />}
                                            </button>
                                        )}
                                    </>
                                )}
                             </div>
                        </div>
                    </div>
                    {error && <div className="mt-4 bg-red-100 text-red-700 px-3 py-2 text-sm rounded-md" role="alert">{error}</div>}
                </div>
                <div className="bg-slate-50 px-6 py-4 flex justify-end items-center rounded-b-lg border-t">
                    <button onClick={handleGenerate} disabled={!inputText.trim() || isLoading} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 flex items-center justify-center gap-2 w-40">
                         {isLoading ? 'Generating...' : 'Generate'}
                    </button>
                </div>
            </div>
            <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
        </div>
    );
};


const App: React.FC = () => {
    // --- AI USAGE LIMITER ---
    const { usage: aiUsage, isLimitReached, tryAiFeature } = useAiLimiter();

    // --- SHARED STATE ---
    const [accounts, setAccounts] = useState<Account[]>(() => {
        const defaultAccounts = [{ id: '0', code: '0000', name: 'Uncategorized', type: 'Unclassified' }];
        try {
            const savedAccounts = localStorage.getItem('bankAnalyzerAccounts');
            if (savedAccounts) {
                const parsed = JSON.parse(savedAccounts);
                if (Array.isArray(parsed) && parsed.length > 0) return parsed;
            }
        } catch (error) { console.error("Could not load accounts from local storage", error); }
        return defaultAccounts;
    });
    const [isChartOfAccountsModalOpen, setIsChartOfAccountsModalOpen] = useState(false);
    const [view, setView] = useState<AppView>('statement');
    const [isTextImproverOpen, setIsTextImproverOpen] = useState(false);
    const [isAnalystModalOpen, setIsAnalystModalOpen] = useState(false);

    useEffect(() => {
        try { localStorage.setItem('bankAnalyzerAccounts', JSON.stringify(accounts)); } catch (error) { console.error("Could not save accounts to local storage", error); }
    }, [accounts]);
    
    const handleSaveAccounts = (newAccounts: Account[]) => {
        setAccounts(newAccounts);
        setIsChartOfAccountsModalOpen(false);
    };

    // --- STATEMENT ANALYSIS STATE ---
    const [appState, setAppState] = useState<AppState>('init');
    const [transactions, setTransactions] = useState<Transaction[]>([]);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [isSaveModalOpen, setIsSaveModalOpen] = useState(false);
    const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
    const [editingSessionName, setEditingSessionName] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [isExporting, setIsExporting] = useState(false);
    const [isExportMenuOpen, setIsExportMenuOpen] = useState(false);
    const [suggestingForTxId, setSuggestingForTxId] = useState<string | null>(null);
    const [editingTransactionForNote, setEditingTransactionForNote] = useState<Transaction | null>(null);
    const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
    const [bulkAssignAccountCode, setBulkAssignAccountCode] = useState<string>('');
    const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
    const [filters, setFilters] = useState(initialFilters);
    const [sortConfig, setSortConfig] = useState<{ key: SortKey; direction: SortDirection }>({ key: 'date', direction: 'desc' });
    
    const exportMenuRef = useRef<HTMLDivElement>(null);
    const selectAllCheckboxRef = useRef<HTMLInputElement>(null);

    // --- CASHBOOK STATE ---
    const [cashbookEntries, setCashbookEntries] = useState<CashbookEntry[]>([]);
    const [currentCashbookEntry, setCurrentCashbookEntry] = useState<Partial<CashbookEntry> | null>(null);
    const [isAnalyzingMemo, setIsAnalyzingMemo] = useState(false);
    const [memoInputText, setMemoInputText] = useState('');
    const [memoError, setMemoError] = useState('');
    const [editingCashbookEntry, setEditingCashbookEntry] = useState<CashbookEntry | null>(null);
    const [editingCashbookNoteEntry, setEditingCashbookNoteEntry] = useState<CashbookEntry | null>(null);
    const [cashbookSortConfig, setCashbookSortConfig] = useState<{ key: CashbookSortKey | null; direction: SortDirection }>({ key: 'date', direction: 'desc' });
    const [isCashbookFullscreen, setIsCashbookFullscreen] = useState(false);
    const [isLinkTxModalOpen, setIsLinkTxModalOpen] = useState(false);
    const memoFileInputRef = useRef<HTMLInputElement>(null);


    // --- LIFECYCLE HOOKS ---
    useEffect(() => {
        try {
            const savedSessions = localStorage.getItem('bankAnalyzerSessions');
            if (savedSessions) setSessions(JSON.parse(savedSessions));

            const savedCashbook = localStorage.getItem('bankAnalyzerCashbook');
            if (savedCashbook) setCashbookEntries(JSON.parse(savedCashbook));

        } catch (error) {
            console.error("Could not load data from local storage", error);
            localStorage.removeItem('bankAnalyzerSessions');
            localStorage.removeItem('bankAnalyzerCashbook');
        }
        setAppState('upload');
    }, []);

    useEffect(() => {
        try { localStorage.setItem('bankAnalyzerSessions', JSON.stringify(sessions)); } catch (error) { console.error("Could not save sessions to local storage", error); }
    }, [sessions]);
    
    useEffect(() => {
        try { localStorage.setItem('bankAnalyzerCashbook', JSON.stringify(cashbookEntries)); } catch (error) { console.error("Could not save cashbook to local storage", error); }
    }, [cashbookEntries]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => { if (exportMenuRef.current && !exportMenuRef.current.contains(event.target as Node)) setIsExportMenuOpen(false); };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // --- STATEMENT ANALYSIS FUNCTIONS ---
    const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
            setErrorMessage('Please upload a valid PDF file.');
            event.target.value = '';
            return;
        }

        if (!tryAiFeature()) {
            event.target.value = '';
            return;
        }

        setAppState('analyzing');
        setTransactions([]);
        setErrorMessage('');
        setIsStreaming(true);
        setActiveSessionId(null);
        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const pdfPart = await fileToGenerativePart(file);
            const prompt = `You are an expert data extraction AI. Your task is to analyze the provided PDF bank statement and extract every transaction. Process the entire document. For each transaction, output a single, minified JSON object on its own line. Do not include any other text, explanations, or markdown. Each JSON object must contain: "date" (string, "YYYY-MM-DD"), "description" (string), "amount" (number), and "type" (string, either "debit" or "credit").`;

            const stream = await ai.models.generateContentStream({ model: "gemini-2.5-flash", contents: { parts: [{ text: prompt }, pdfPart] } });

            let buffer = '';
            let transactionCount = 0;
            for await (const chunk of stream) {
                buffer += chunk.text;
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';
                
                const newTxs: Transaction[] = lines.flatMap(line => {
                    if (!line.trim()) return [];
                    try {
                        // FIX: Cast the parsed JSON to handle strict TS configs where JSON.parse returns `unknown`.
                        // Also, strengthen the check for the `type` property.
                        const txData = JSON.parse(line) as Partial<Transaction>;
                        if (txData.date && txData.description && typeof txData.amount === 'number' && (txData.type === 'debit' || txData.type === 'credit')) {
                            const noteKey = createTransactionKey(txData as { date: string, description: string, amount: number, type: 'debit' | 'credit' });
                            const savedNote = localStorage.getItem(noteKey);
                            return [{ ...txData, id: `${Date.now()}-${transactionCount++}`, accountCode: '0000', notes: savedNote ?? undefined } as Transaction];
                        }
                    } catch (e) { console.warn("Could not parse JSON line:", line); }
                    return [];
                });
                if (newTxs.length > 0) setTransactions(prev => [...prev, ...newTxs]);
            }
        } catch (error) {
            console.error("Error processing statement:", error);
            setErrorMessage(`Failed to analyze statement. ${error instanceof Error ? error.message : 'Unknown error.'}`);
            setAppState('error');
        } finally {
            setIsStreaming(false);
            event.target.value = '';
        }
    };
    
    const handleUpdateTransactionAccountCode = (id: string, accountCode: string) => {
        setTransactions(txs => txs.map(tx => tx.id === id ? { ...tx, accountCode } : tx));
    };
    
    const handleSaveNote = (txId: string, note: string) => {
        const transaction = transactions.find(tx => tx.id === txId);
        if (transaction) {
            const noteKey = createTransactionKey(transaction);
            if (note) localStorage.setItem(noteKey, note); else localStorage.removeItem(noteKey);
            setTransactions(txs => txs.map(tx => tx.id === txId ? { ...tx, notes: note || undefined } : tx));
        }
        setEditingTransactionForNote(null);
    };

    const handleSuggestAccount = async (txId: string) => {
        const transaction = transactions.find(t => t.id === txId);
        if (!transaction || accounts.length === 0) return;

        if (!tryAiFeature()) return;

        setSuggestingForTxId(txId);
        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const accountList = accounts.map(a => `'${a.name}' (Code: ${a.code})`).join(', ');
            const prompt = `Given the transaction description "${transaction.description}" and available accounts [${accountList}], what is the most suitable account? Respond with a JSON object with a single key "accountName" containing only the account name from the list. If none fit, the value should be "Uncategorized".`;
            const response = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    responseMimeType: 'application/json',
                    responseSchema: {
                        type: Type.OBJECT,
                        properties: {
                            accountName: {type: Type.STRING, description: "The suggested account name."},
                        },
                        required: ['accountName'],
                    }
                }
            });
            const data = JSON.parse(response.text);
            const suggestedAccountName = data.accountName;
            const suggestedAccount = accounts.find(a => a.name === suggestedAccountName);
            if (suggestedAccount) {
                handleUpdateTransactionAccountCode(txId, suggestedAccount.code);
            }
        } catch (error) { console.error("Error suggesting account:", error); } 
        finally { setSuggestingForTxId(null); }
    };
    
    const getAugmentedTransactions = (txs: Transaction[]) => {
        const accountMap = new Map(accounts.map(acc => [acc.code, acc]));
        return txs.map(tx => {
            const account = accountMap.get(tx.accountCode);
            return { ...tx, accountName: account?.name || 'N/A', accountType: account?.type || 'N/A' };
        });
    };

    const handleExportCSV = () => {
        if (isExporting) return;
        setIsExporting(true);
        setIsExportMenuOpen(false);
        const headers = ["ID", "Date", "Description", "Amount", "Type", "Account Code", "Account Name", "Account Type", "Notes", "Reconciled With (Cashbook ID)"];
        const augmentedTxs = getAugmentedTransactions(filteredAndSortedTransactions);
        const rows = augmentedTxs.map(tx => [
            tx.id, tx.date, `"${tx.description.replace(/"/g, '""')}"`, 
            tx.amount, tx.type, tx.accountCode, tx.accountName, tx.accountType, `"${tx.notes?.replace(/"/g, '""') ?? ''}"`,
            tx.reconciledWith ?? ''
        ].join(','));
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "transactions.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        setTimeout(() => setIsExporting(false), 1000);
    };
    
    const handleExportJSON = () => {
        if (isExporting) return;
        setIsExporting(true);
        setIsExportMenuOpen(false);
        const augmentedTxs = getAugmentedTransactions(filteredAndSortedTransactions);
        const jsonData = JSON.stringify(augmentedTxs, null, 2);
        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = "transactions.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
        setTimeout(() => setIsExporting(false), 1000);
    };

    const handleReset = () => {
        setAppState('upload');
        setTransactions([]);
        setErrorMessage('');
        setActiveSessionId(null);
    };

    const handleSaveSession = (name: string) => {
        const existingSession = sessions.find(s => s.name.toLowerCase() === name.toLowerCase());
        if (existingSession) {
            if (!window.confirm(`A session named "${name}" already exists. Do you want to overwrite it?`)) {
                return; 
            }
        }
    
        const newSession: Session = { 
            id: Date.now().toString(), 
            name, 
            timestamp: Date.now(), 
            transactions, 
            accounts, 
        };
        
        setSessions(prev => [...prev.filter(s => s.name.toLowerCase() !== name.toLowerCase()), newSession].sort((a, b) => b.timestamp - a.timestamp));
        setActiveSessionId(newSession.id);
        setIsSaveModalOpen(false);
    };
    
    const handleLoadSession = (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setTransactions(session.transactions);
            setAccounts(session.accounts);
            setAppState('analyzing');
            setView('statement');
            setActiveSessionId(sessionId);
        }
    };

    const handleDeleteSession = (sessionId: string) => {
        if (window.confirm("Are you sure you want to delete this session?")) {
            // Important: Check if it's the active session *before* any state updates.
            if (activeSessionId === sessionId) {
                // Reset the view to prevent working on orphaned data.
                handleReset();
            }
            setSessions(prev => prev.filter(s => s.id !== sessionId));
        }
    };

    const handleSaveSessionName = (sessionId: string) => {
        if (!editingSessionName.trim()) return;
        setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, name: editingSessionName.trim() } : s));
        setEditingSessionId(null);
        setEditingSessionName('');
    };
    
    const requestSort = (key: SortKey) => {
        if (!key) return;
        let direction: SortDirection = 'asc';
        if (sortConfig.key === key && sortConfig.direction === 'asc') direction = 'desc';
        setSortConfig({ key, direction });
    };

    const handleClearFilters = () => {
        setFilters(initialFilters);
        setSortConfig({ key: 'date', direction: 'desc' });
        setSelectedTxIds(new Set());
    };
    
    const filteredAndSortedTransactions = useMemo(() => {
        let filtered = transactions.filter(tx => {
            const searchLower = filters.searchQuery.toLowerCase();
            const txDate = new Date(tx.date);
            const startDate = filters.dateRange.start ? new Date(filters.dateRange.start) : null;
            if (startDate) startDate.setHours(0, 0, 0, 0);
            const endDate = filters.dateRange.end ? new Date(filters.dateRange.end) : null;
            if (endDate) endDate.setHours(23, 59, 59, 999);
            if ((startDate && txDate < startDate) || (endDate && txDate > endDate)) return false;
            const minAmount = filters.amountRange.min !== '' ? parseFloat(filters.amountRange.min) : -Infinity;
            const maxAmount = filters.amountRange.max !== '' ? parseFloat(filters.amountRange.max) : Infinity;
            if (tx.amount < minAmount || tx.amount > maxAmount) return false;

            return (
                (tx.description.toLowerCase().includes(searchLower) || tx.notes?.toLowerCase().includes(searchLower)) &&
                (filters.filterAccountCode === 'all' || tx.accountCode === filters.filterAccountCode) &&
                (filters.filterType === 'all' || tx.type === filters.filterType) &&
                (filters.filterReconciled === 'all' ||
                 (filters.filterReconciled === 'reconciled' && tx.reconciledWith) ||
                 (filters.filterReconciled === 'unreconciled' && !tx.reconciledWith)
                )
            );
        });

        if (sortConfig.key) {
            const key = sortConfig.key;
            filtered.sort((a, b) => {
                const valA = a[key] ?? ''; const valB = b[key] ?? ''; let comparison = 0;
                if (key === 'amount') comparison = (valA as number) - (valB as number);
                else if (key === 'date') comparison = new Date(valA as string).getTime() - new Date(valB as string).getTime();
                else comparison = String(valA).toLowerCase().localeCompare(String(valB).toLowerCase());
                return sortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return filtered;
    }, [transactions, filters, sortConfig]);
    
    const handleSelectTx = (txId: string) => {
        setSelectedTxIds(prev => {
            const newSet = new Set(prev);
            if (newSet.has(txId)) {
                newSet.delete(txId);
            } else {
                newSet.add(txId);
            }
            return newSet;
        });
    };

    const handleSelectAllVisible = () => {
        const visibleTxIds = new Set(filteredAndSortedTransactions.map(tx => tx.id));
        const allCurrentlyVisibleAreSelected = filteredAndSortedTransactions.length > 0 && filteredAndSortedTransactions.every(tx => selectedTxIds.has(tx.id));

        setSelectedTxIds(prevSelectedIds => {
            const newSelectedIds = new Set(prevSelectedIds);
            if (allCurrentlyVisibleAreSelected) {
                visibleTxIds.forEach(id => newSelectedIds.delete(id));
            } else {
                visibleTxIds.forEach(id => newSelectedIds.add(id));
            }
            return newSelectedIds;
        });
    };
    
    const handleBulkAssign = () => {
        if (!bulkAssignAccountCode || selectedTxIds.size === 0) return;
        setTransactions(prevTxs =>
            prevTxs.map(tx =>
                selectedTxIds.has(tx.id) ? { ...tx, accountCode: bulkAssignAccountCode } : tx
            )
        );
        setSelectedTxIds(new Set());
        setBulkAssignAccountCode('');
    };

    const allVisibleSelected = useMemo(() =>
        filteredAndSortedTransactions.length > 0 && filteredAndSortedTransactions.every(tx => selectedTxIds.has(tx.id)),
        [filteredAndSortedTransactions, selectedTxIds]
    );

    const someVisibleSelected = useMemo(() =>
        filteredAndSortedTransactions.some(tx => selectedTxIds.has(tx.id)),
        [filteredAndSortedTransactions, selectedTxIds]
    );

    useEffect(() => {
        if (selectAllCheckboxRef.current) {
            selectAllCheckboxRef.current.checked = allVisibleSelected;
            selectAllCheckboxRef.current.indeterminate = !allVisibleSelected && someVisibleSelected;
        }
    }, [allVisibleSelected, someVisibleSelected]);

    const summary = useMemo(() => {
        const totalDebits = filteredAndSortedTransactions.filter(t => t.type === 'debit').reduce((sum, t) => sum + t.amount, 0);
        const totalCredits = filteredAndSortedTransactions.filter(t => t.type === 'credit').reduce((sum, t) => sum + t.amount, 0);
        return { totalDebits, totalCredits, netFlow: totalCredits - totalDebits };
    }, [filteredAndSortedTransactions]);
    
    const currencyFormatter = new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN' });

    // --- CASHBOOK FUNCTIONS ---
    const unreconciledTransactions = useMemo(() => {
        const linkedIds = new Set(cashbookEntries.map(e => e.linkedTransactionId).filter(Boolean));
        return transactions.filter(tx => !tx.reconciledWith && !linkedIds.has(tx.id));
    }, [transactions, cashbookEntries]);

    const handleOpenLinkModal = () => setIsLinkTxModalOpen(true);

    const handleSelectTransactionToLink = (txId: string) => {
        if (editingCashbookEntry) {
            setEditingCashbookEntry(prev => prev ? { ...prev, linkedTransactionId: txId } : null);
        } else if (currentCashbookEntry) {
            setCurrentCashbookEntry(prev => prev ? { ...prev, linkedTransactionId: txId } : null);
        }
        setIsLinkTxModalOpen(false);
    };

    const handleUnlinkTransaction = () => {
        if (editingCashbookEntry) {
            setEditingCashbookEntry(prev => prev ? { ...prev, linkedTransactionId: undefined } : null);
        } else if (currentCashbookEntry) {
            setCurrentCashbookEntry(prev => prev ? { ...prev, linkedTransactionId: undefined } : null);
        }
    };
    
    const handleUnlinkCashbookEntry = (entryId: string) => {
        const entryToUnlink = cashbookEntries.find(e => e.id === entryId);
        if (!entryToUnlink || !entryToUnlink.linkedTransactionId) return;

        const linkedTxId = entryToUnlink.linkedTransactionId;

        // Update transactions state: remove reconciledWith from the transaction
        setTransactions(prevTxs => prevTxs.map(tx => 
            tx.id === linkedTxId ? { ...tx, reconciledWith: undefined } : tx
        ));

        // Update cashbookEntries state: remove linkedTransactionId from the entry
        setCashbookEntries(prev => prev.map(entry => 
            entry.id === entryId ? { ...entry, linkedTransactionId: undefined } : entry
        ));
    };

    const requestCashbookSort = (key: CashbookSortKey) => {
        let direction: SortDirection = 'asc';
        if (cashbookSortConfig.key === key && cashbookSortConfig.direction === 'asc') {
            direction = 'desc';
        }
        setCashbookSortConfig({ key, direction });
    };

    const sortedCashbookEntries = useMemo(() => {
        const sortableEntries = [...cashbookEntries];
        if (cashbookSortConfig.key) {
            const key = cashbookSortConfig.key;
            sortableEntries.sort((a, b) => {
                let comparison = 0;
                if (key === 'amount') {
                    const valA = a.debit > 0 ? a.debit : a.credit;
                    const valB = b.debit > 0 ? b.debit : b.credit;
                    comparison = valA - valB;
                } else {
                    const valA = a[key as keyof CashbookEntry] ?? '';
                    const valB = b[key as keyof CashbookEntry] ?? '';
                    if (key === 'date') {
                        comparison = new Date(valA as string).getTime() - new Date(valB as string).getTime();
                    } else {
                        comparison = String(valA).toLowerCase().localeCompare(String(valB).toLowerCase());
                    }
                }
                return cashbookSortConfig.direction === 'asc' ? comparison : -comparison;
            });
        }
        return sortableEntries;
    }, [cashbookEntries, cashbookSortConfig]);

    const currentCashbookLinkedTx = useMemo(() => {
        if (!currentCashbookEntry?.linkedTransactionId) return null;
        return transactions.find(t => t.id === currentCashbookEntry.linkedTransactionId);
    }, [currentCashbookEntry, transactions]);


    const handleAnalyzeMemo = async (input: { text?: string; file?: File }) => {
        if (!input.text && !input.file) return;

        if (!tryAiFeature()) return;

        setIsAnalyzingMemo(true);
        setCurrentCashbookEntry(null);
        setMemoError('');
        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });

            const accountsList = accounts.map(a => ({ code: a.code, name: a.name, type: a.type }));
            const prompt = `You are an expert accounting assistant. Your task is to extract information from the provided document (an internal memo or invoice) and format it as a single, minified JSON object for a cashbook entry.

            Use the following Chart of Accounts to select the most appropriate Account ID:
            ${JSON.stringify(accountsList)}

            The JSON object must have these exact keys:
            - "date": (string, "YYYY-MM-DD") The date mentioned in the memo/invoice. If a specific date is present, extract it. If no date is found in the document, return an empty string "" for this field.
            - "reference": (string) A short, unique reference code you generate based on the document's content (e.g., MEMO-INS-1025).
            - "description": (string) The subject or a concise summary of the request.
            - "accountId": (string) The numeric code from the provided Chart of Accounts that best fits the expense.
            - "debit": (number) The total amount of the expense. If it's an income document, this should be 0.
            - "credit": (number) The total amount of income. If it's an expense document, this should be 0.
            - "bankAccountId": (string) Default to "12102-3".
            - "department": (string) The department or expense category mentioned (e.g., "Admin").
            - "taxCode": (string) Default to "VAT0".
            - "vendor": (string) The name of the vendor or the payee.
            - "memoReference": (string) An internal reference number you generate based on the document (e.g., IHMS/ADMIN/MAINT/1025).
            - "notes": (string) A detailed summary of the memo's 'Background' and 'Request' sections. Capture the essence of why the expense is needed.

            Do not include any other text, explanations, or markdown. Only output the single, minified JSON object.`;

            const parts: ({ text: string } | { inlineData: { data: string; mimeType: string; } })[] = [{ text: prompt }];
            if (input.file) {
                const filePart = await fileToGenerativePart(input.file);
                parts.push(filePart);
            }
            if (input.text) {
                parts.push({ text: `\n\n---DOCUMENT TEXT---\n\n${input.text}` });
            }
            
            const response = await ai.models.generateContent({ model: 'gemini-2.5-flash', contents: { parts }, config: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: Type.OBJECT,
                    properties: {
                        date: { type: Type.STRING },
                        reference: { type: Type.STRING },
                        description: { type: Type.STRING },
                        accountId: { type: Type.STRING },
                        debit: { type: Type.NUMBER },
                        credit: { type: Type.NUMBER },
                        bankAccountId: { type: Type.STRING },
                        department: { type: Type.STRING },
                        taxCode: { type: Type.STRING },
                        vendor: { type: Type.STRING },
                        memoReference: { type: Type.STRING },
                        notes: { type: Type.STRING },
                    }
                }
            } });
            
            const jsonText = response.text.trim();
            const parsed = JSON.parse(jsonText);

            if (!parsed.date) {
                parsed.date = new Date().toISOString().split('T')[0];
            }
            
            setCurrentCashbookEntry(parsed);

        } catch (error) {
            console.error("Error analyzing memo:", error);
            setMemoError(`Failed to analyze document. ${error instanceof Error ? error.message : 'Unknown error.'}`);
        } finally {
            setIsAnalyzingMemo(false);
            setMemoInputText('');
            if (memoFileInputRef.current) memoFileInputRef.current.value = '';
        }
    };

    const handleManualAddCashbookEntry = () => {
        setCurrentCashbookEntry({
            date: new Date().toISOString().split('T')[0],
            reference: '',
            description: '',
            accountId: '0000',
            debit: 0,
            credit: 0,
            bankAccountId: '12102-3',
            department: '',
            taxCode: 'VAT0',
            vendor: '',
            memoReference: '',
            notes: '',
        });
        setMemoError('');
        setIsAnalyzingMemo(false);
        setMemoInputText('');
        if (memoFileInputRef.current) {
            memoFileInputRef.current.value = '';
        }
    };

    const handleSaveCashbookEntry = () => {
        if (!currentCashbookEntry) return;

        const isDuplicate = cashbookEntries.some(entry =>
            entry.date === currentCashbookEntry.date &&
            entry.vendor?.toLowerCase() === currentCashbookEntry.vendor?.toLowerCase() &&
            (entry.debit > 0 && entry.debit === Number(currentCashbookEntry.debit))
        );

        if (isDuplicate) {
            if (!window.confirm("A very similar entry already exists. Are you sure you want to save this one too?")) {
                return;
            }
        }

        const newEntry: CashbookEntry = {
            id: Date.now().toString(),
            date: currentCashbookEntry.date || '',
            reference: currentCashbookEntry.reference || '',
            description: currentCashbookEntry.description || '',
            accountId: currentCashbookEntry.accountId || '',
            debit: Number(currentCashbookEntry.debit) || 0,
            credit: Number(currentCashbookEntry.credit) || 0,
            bankAccountId: currentCashbookEntry.bankAccountId || '',
            department: currentCashbookEntry.department || '',
            taxCode: currentCashbookEntry.taxCode || '',
            vendor: currentCashbookEntry.vendor || '',
            memoReference: currentCashbookEntry.memoReference || '',
            notes: currentCashbookEntry.notes || '',
            linkedTransactionId: currentCashbookEntry.linkedTransactionId
        };

        if (newEntry.linkedTransactionId) {
            setTransactions(prevTxs => prevTxs.map(tx => tx.id === newEntry.linkedTransactionId ? { ...tx, reconciledWith: newEntry.id } : tx));
        }

        setCashbookEntries(prev => [newEntry, ...prev]);
        setCurrentCashbookEntry(null);
    };

    const handleUpdateCurrentCashbookEntry = (field: keyof CashbookEntry, value: string | number) => {
        if (!currentCashbookEntry) return;
        setCurrentCashbookEntry(prev => ({...prev, [field]: value }));
    };

    const handleDeleteCashbookEntry = (id: string) => {
        if (window.confirm("Are you sure you want to delete this cashbook entry?")) {
            const entryToDelete = cashbookEntries.find(entry => entry.id === id);
            if (entryToDelete?.linkedTransactionId) {
                setTransactions(prevTxs => prevTxs.map(tx =>
                    tx.id === entryToDelete.linkedTransactionId
                        ? { ...tx, reconciledWith: undefined }
                        : tx
                ));
            }
            setCashbookEntries(prev => prev.filter(entry => entry.id !== id));
        }
    };
    
    const handleUpdateCashbookEntry = (updatedEntry: CashbookEntry) => {
        const originalEntry = cashbookEntries.find(entry => entry.id === updatedEntry.id);
        
        setTransactions(prevTxs => {
            const newTxs = [...prevTxs];
            const oldLinkedTxId = originalEntry?.linkedTransactionId;
            const newLinkedTxId = updatedEntry.linkedTransactionId;
    
            if (oldLinkedTxId && oldLinkedTxId !== newLinkedTxId) {
                const oldTxIndex = newTxs.findIndex(tx => tx.id === oldLinkedTxId);
                if (oldTxIndex > -1) newTxs[oldTxIndex] = { ...newTxs[oldTxIndex], reconciledWith: undefined };
            }
    
            if (newLinkedTxId && newLinkedTxId !== oldLinkedTxId) {
                const newTxIndex = newTxs.findIndex(tx => tx.id === newLinkedTxId);
                if (newTxIndex > -1) newTxs[newTxIndex] = { ...newTxs[newTxIndex], reconciledWith: updatedEntry.id };
            }
            return newTxs;
        });
        
        setCashbookEntries(prev => prev.map(entry => entry.id === updatedEntry.id ? updatedEntry : entry));
        setEditingCashbookEntry(null);
    };

    const handleSaveCashbookNote = (entryId: string, note: string) => {
        setCashbookEntries(prev => prev.map(entry => entry.id === entryId ? { ...entry, notes: note || undefined } : entry));
        setEditingCashbookNoteEntry(null);
    };

    const handleExportCashbookCSV = () => {
        const headers = ["Date", "Reference", "Description", "Account ID", "Debit", "Credit", "Bank Account ID", "Department", "Tax Code", "Vendor", "Memo Reference", "Notes", "Linked Transaction ID"];
        const rows = cashbookEntries.map(entry => [
            entry.date, entry.reference, `"${entry.description.replace(/"/g, '""')}"`, entry.accountId, entry.debit, entry.credit, entry.bankAccountId, entry.department, entry.taxCode, `"${entry.vendor.replace(/"/g, '""')}"`, entry.memoReference, `"${entry.notes?.replace(/"/g, '""') ?? ''}"`,
            entry.linkedTransactionId ?? ''
        ].join(','));
        const csvContent = "data:text/csv;charset=utf-8," + [headers.join(','), ...rows].join('\n');
        const link = document.createElement("a");
        link.setAttribute("href", encodeURI(csvContent));
        link.setAttribute("download", "cashbook.csv");
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };


    // --- AI Analyst Modal ---
    const AiAnalystModal = ({ isOpen, onClose, data, dataName }: { isOpen: boolean, onClose: () => void, data: any[], dataName: string }) => {
        const [question, setQuestion] = useState('');
        const [answer, setAnswer] = useState('');
        const [isLoading, setIsLoading] = useState(false);
        const [error, setError] = useState('');

        useEffect(() => {
            if (!isOpen) { // Reset state when modal is closed
                setQuestion(''); setAnswer(''); setError(''); setIsLoading(false);
            }
        }, [isOpen]);

        const handleAsk = async () => {
            if (!question.trim() || data.length === 0) return;
            if (!tryAiFeature()) return;

            setIsLoading(true);
            setError('');
            setAnswer('');
            try {
                const ai = new GoogleGenAI({ apiKey: getApiKey() });
                const MAX_RECORDS = 200;
                let truncatedData = data;
                let truncationMessage = '';
                if (data.length > MAX_RECORDS) {
                    truncatedData = data.slice(0, MAX_RECORDS);
                    truncationMessage = `\n\nNote: The analysis was performed on the first ${MAX_RECORDS} of ${data.length} visible records for performance reasons.`;
                }

                const prompt = `You are a helpful financial analyst. Based ONLY on the following data, which is a JSON array of ${dataName}, answer the user's question. Provide a concise but comprehensive answer. Format your response clearly using paragraphs, lists, or bold text as needed. If the question cannot be answered from the data, state that clearly.

                Data:
                \`\`\`json
                ${JSON.stringify(truncatedData, null, 2)}
                \`\`\`

                User's Question: "${question}"`;
                
                const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
                setAnswer(response.text.trim() + truncationMessage);
            } catch (err) {
                console.error("AI Analyst Error:", err);
                setError(err instanceof Error ? err.message : "An unknown error occurred while analyzing the data.");
            } finally {
                setIsLoading(false);
            }
        };
        
        if (!isOpen) return null;

        return (
            <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4" onClick={onClose}>
                <div className="bg-white rounded-lg shadow-xl w-full max-w-3xl h-[80vh] flex flex-col transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                    <div className="p-6 border-b flex items-center justify-between flex-shrink-0">
                        <h3 className="text-xl font-semibold text-slate-800 flex items-center gap-2"><BrainIcon className="w-6 h-6 text-indigo-500" /> AI Financial Analyst</h3>
                        <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100"><XIcon className="w-5 h-5" /></button>
                    </div>
                    <div className="flex-grow p-6 overflow-y-auto">
                        <label htmlFor="ai-analyst-answer" className="text-sm font-medium text-slate-600">Answer</label>
                        <div id="ai-analyst-answer" className="mt-1 w-full h-full min-h-[200px] p-3 border border-slate-300 rounded-md bg-slate-50 text-sm whitespace-pre-wrap overflow-y-auto">
                            {isLoading ? (
                                <div className="flex items-center justify-center h-full text-slate-500 gap-2">
                                    <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <span>Analyzing your data...</span>
                                </div>
                            ) : error ? (
                                <div className="text-red-600">{error}</div>
                            ) : answer ? (
                                <p>{answer}</p>
                            ) : (
                                <div className="text-slate-500 h-full flex items-center justify-center">
                                    <p className="text-center">Ask a question about the currently visible {dataName} to get started.<br/>e.g., "What is the sum of all debits?" or "List all transactions related to 'supplies'".</p>
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="bg-slate-50 px-6 py-4 flex-shrink-0 border-t">
                        <div className="flex items-start gap-4">
                            <textarea 
                                value={question} 
                                onChange={e => setQuestion(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleAsk(); } }}
                                rows={3} 
                                className="flex-grow p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-sm" 
                                placeholder={`Ask a question about the ${data.length} visible ${dataName}...`}
                            />
                            <button onClick={handleAsk} disabled={!question.trim() || isLoading} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 flex items-center justify-center gap-2 h-[76px]">
                                {isLoading ? 'Thinking...' : 'Ask'}
                            </button>
                        </div>
                    </div>
                </div>
                <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        );
    };

    // --- RENDER LOGIC ---

    const SortableHeader = ({ label, sortKey }: { label: string, sortKey: keyof Transaction }) => (
        <th className="px-4 py-3 cursor-pointer select-none group" onClick={() => requestSort(sortKey)}>
            <div className="flex items-center">
                <span>{label}</span>
                <ArrowUpDownIcon className={`w-4 h-4 ml-1.5 transition-opacity ${sortConfig.key === sortKey ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'}`} direction={sortConfig.key === sortKey ? sortConfig.direction : 'none'} />
            </div>
        </th>
    );

    if (appState === 'init') return <div className="min-h-screen bg-slate-100 flex items-center justify-center"><div className="w-16 h-16 border-4 border-indigo-500 border-dashed rounded-full animate-spin"></div></div>;

    if (appState === 'upload' || appState === 'error') {
        return (
            <div className="min-h-screen bg-slate-100 flex flex-col items-center justify-center p-4">
                <div className="text-center mb-8">
                    <h1 className="text-4xl font-bold text-slate-800">Management Accountant Dashboard</h1>
                    <p className="text-slate-600 mt-2">Analyze bank statements or create cashbook entries from memos.</p>
                </div>
                <div className="w-full max-w-2xl">
                    <label
                        htmlFor="file-upload"
                        title={isLimitReached ? `Daily AI usage limit of ${aiUsage.limit} has been reached.` : "Upload a Bank Statement (PDF)"}
                        className={`relative rounded-lg border-2 border-dashed border-slate-300 transition-all p-10 flex flex-col items-center justify-center text-center 
                        ${isLimitReached ? 'opacity-60 cursor-not-allowed bg-slate-50' : 'bg-white hover:border-indigo-500 cursor-pointer'}`}
                    >
                        <UploadIcon className="w-12 h-12 text-slate-400 mb-4" />
                        <span className="text-lg font-semibold text-slate-700">Upload a Bank Statement (PDF)</span>
                        <p className="text-sm text-slate-500 mt-1">to begin Statement Analysis</p>
                        <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={handleFileChange} accept=".pdf,application/pdf" disabled={isLimitReached} />
                         {isLimitReached && <div className="absolute inset-0 bg-white bg-opacity-50 flex items-center justify-center"><span className="bg-red-100 text-red-700 font-bold px-4 py-2 rounded-lg shadow-sm">AI Daily Limit Reached</span></div>}
                    </label>
                    <div className="my-4 text-center text-slate-500 font-semibold">OR</div>
                    <button onClick={() => { setView('cashbook'); setAppState('analyzing'); }} className="w-full bg-white rounded-lg border-2 border-dashed border-slate-300 hover:border-teal-500 transition-all p-10 flex flex-col items-center justify-center text-center">
                         <ClipboardListIcon className="w-12 h-12 text-slate-400 mb-4" />
                         <span className="text-lg font-semibold text-slate-700">Go to Cashbook Entry</span>
                         <p className="text-sm text-slate-500 mt-1">to create records from memos or invoices</p>
                    </button>
                    {errorMessage && <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert"><strong className="font-bold">Error:</strong><span className="block sm:inline ml-2">{errorMessage}</span></div>}
                     {sessions.length > 0 && (
                        <div className="mt-8 bg-white p-6 rounded-xl shadow-md">
                            <h2 className="text-xl font-semibold text-slate-700 mb-4">Saved Sessions (Statement Analysis)</h2>
                            <ul className="space-y-3">
                                {sessions.map(session => (
                                    <li key={session.id} className={`flex items-center justify-between p-3 bg-slate-50 rounded-lg transition-all duration-200 flex-wrap gap-2 ${editingSessionId === session.id ? 'ring-2 ring-indigo-400 bg-white shadow-sm' : 'hover:bg-slate-100'}`}>
                                        {editingSessionId === session.id ? (
                                            <div className="flex-grow flex items-center gap-2">
                                                <input type="text" value={editingSessionName} onChange={e => setEditingSessionName(e.target.value)} onKeyUp={e => e.key === 'Enter' && handleSaveSessionName(session.id)} className="w-full border-slate-300 rounded-md px-2 py-1 focus:ring-1 focus:ring-indigo-500 focus:border-indigo-500 text-sm" autoFocus />
                                                <button onClick={() => handleSaveSessionName(session.id)} className="p-2 text-slate-500 hover:text-green-600"><CheckIcon className="w-4 h-4" /></button>
                                                <button onClick={() => { setEditingSessionId(null); setEditingSessionName(''); }} className="p-2 text-slate-500 hover:text-red-600"><XIcon className="w-4 h-4" /></button>
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex-grow">
                                                    <p className="font-semibold text-slate-800">{session.name}</p>
                                                    <p className="text-sm text-slate-500">Saved on: {new Date(session.timestamp).toLocaleDateString()}</p>
                                                </div>
                                                <div className="flex items-center gap-2 flex-shrink-0">
                                                    <button onClick={() => handleLoadSession(session.id)} className="bg-indigo-600 text-white font-semibold text-sm px-4 py-1.5 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Load</button>
                                                    <button onClick={() => { setEditingSessionId(session.id); setEditingSessionName(session.name); }} className="p-2 text-slate-400 hover:text-indigo-600"><PencilIcon className="w-4 h-4" /></button>
                                                    <button onClick={() => handleDeleteSession(session.id)} className="p-2 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                                                </div>
                                            </>
                                        )}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                </div>
            </div>
        );
    }
    
    const renderHeader = () => {
        const activeSession = activeSessionId ? sessions.find(s => s.id === activeSessionId) : null;
        return (
            <header className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-6">
                 <div>
                    <h1 className="text-3xl font-bold text-slate-800 flex items-baseline flex-wrap">
                        <span>{view === 'statement' ? 'Transaction Analysis' : 'Cashbook Recording'}</span>
                        {view === 'statement' && activeSession && (
                             <span className="text-base font-medium text-slate-500 ml-3 bg-indigo-100 text-indigo-700 px-3 py-1 rounded-full mt-1 sm:mt-0">
                                Session: {activeSession.name}
                            </span>
                        )}
                    </h1>
                    <p className="text-slate-500 mt-1">
                        {view === 'statement' ? 'Review, categorize, and export your financial data.' : 'Create traceable transaction records from memos and invoices.'}
                    </p>
                </div>
                 <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                     <div title="Your daily AI feature usage count. Resets every day." className="text-sm font-semibold text-slate-600 bg-slate-200 px-3 py-1.5 rounded-lg">
                        AI Usage Today: {aiUsage.count} / {aiUsage.limit}
                    </div>
                     <div className="bg-slate-200 p-1 rounded-lg flex items-center">
                        <button onClick={() => setView('statement')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors ${view === 'statement' ? 'bg-white text-indigo-600 shadow-sm' : 'text-slate-600 hover:bg-slate-300'}`}>
                            <BookOpenIcon className="w-5 h-5" /> <span className="hidden sm:inline">Statement Analysis</span>
                        </button>
                        <button onClick={() => setView('cashbook')} className={`px-3 py-1.5 text-sm font-semibold rounded-md flex items-center gap-2 transition-colors ${view === 'cashbook' ? 'bg-white text-teal-600 shadow-sm' : 'text-slate-600 hover:bg-slate-300'}`}>
                            <ClipboardListIcon className="w-5 h-5" /> <span className="hidden sm:inline">Cashbook Entry</span>
                        </button>
                    </div>
                     <button onClick={() => setIsAnalystModalOpen(true)} className="bg-white text-slate-700 border border-slate-300 font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2">
                        <BrainIcon className="w-5 h-5"/> <span className="hidden sm:inline">Ask AI Analyst</span>
                    </button>
                     <button onClick={() => setIsChartOfAccountsModalOpen(true)} className="bg-white text-slate-700 border border-slate-300 font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2">
                        <BookOpenIcon className="w-5 h-5"/> <span className="hidden sm:inline">Chart of Accounts</span>
                    </button>
                     {view === 'statement' && (
                         <button onClick={handleReset} className="bg-rose-500 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-rose-600 transition-colors flex items-center gap-2">
                            <TrashIcon className="w-5 h-5" /> <span className="hidden sm:inline">New Statement</span>
                        </button>
                     )}
                </div>
            </header>
        );
    };

    const renderStatementView = () => (
        <>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            <div className="bg-white p-6 rounded-xl shadow-md flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 lg:col-span-2">
                 <div>
                    <h2 className="text-xl font-semibold text-slate-700">Transactions</h2>
                    <p className="text-sm text-slate-500 mt-1">Showing <span className="font-bold text-slate-800">{filteredAndSortedTransactions.length}</span> of <span className="font-bold text-slate-800"> {transactions.length} </span> transactions.</p>
                 </div>
                 <div className="flex items-center gap-2 sm:gap-4">
                    <button onClick={() => setIsFilterPanelOpen(true)} className="bg-white text-slate-700 border border-slate-300 font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-slate-50 transition-colors flex items-center gap-2">
                         <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 01-.659 1.591l-5.432 5.432a2.25 2.25 0 00-.659 1.591v2.927a2.25 2.25 0 01-1.244 2.013L9.75 21v-6.572a2.25 2.25 0 00-.659-1.591L3.659 7.409A2.25 2.25 0 013 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0112 3z" /></svg>
                        <span>Filters</span>
                    </button>
                    <button onClick={() => setIsSaveModalOpen(true)} className="bg-white text-indigo-600 border border-indigo-600 font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-indigo-50 transition-colors flex items-center gap-2">
                        <SaveIcon className="w-5 h-5" /> <span className="hidden sm:inline">Save Session</span>
                    </button>
                    <div className="relative" ref={exportMenuRef}>
                        <button onClick={() => setIsExportMenuOpen(prev => !prev)} disabled={isExporting} className="bg-green-600 text-white font-semibold py-2 pl-4 pr-2 rounded-lg shadow-sm hover:bg-green-700 transition-colors flex items-center gap-2 disabled:bg-slate-400">
                            {isExporting ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <DownloadIcon className="w-5 h-5" />}
                            <span className="hidden sm:inline">{isExporting ? 'Exporting...' : 'Export'}</span>
                            <svg className="h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" /></svg>
                        </button>
                        {isExportMenuOpen && (
                            <div className="absolute right-0 mt-2 w-48 origin-top-right bg-white rounded-md shadow-lg z-20 ring-1 ring-black ring-opacity-5 focus:outline-none animate-fade-in-fast">
                                <div className="py-1" role="menu"><button onClick={(e) => { e.preventDefault(); handleExportCSV(); }} className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100" role="menuitem">Export as CSV</button><button onClick={(e) => { e.preventDefault(); handleExportJSON(); }} className="block w-full text-left px-4 py-2 text-sm text-slate-700 hover:bg-slate-100" role="menuitem">Export as JSON</button></div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <div className="bg-white p-6 rounded-xl shadow-md"><h2 className="text-xl font-semibold text-slate-700 mb-4">Summary</h2><div className="space-y-3"><div className="flex justify-between items-baseline"><span className="text-slate-500">Total Outgoing (Debits)</span><span className="font-semibold text-red-500 text-lg">{currencyFormatter.format(summary.totalDebits)}</span></div><div className="flex justify-between items-baseline"><span className="text-slate-500">Total Incoming (Credits)</span><span className="font-semibold text-green-500 text-lg">{currencyFormatter.format(summary.totalCredits)}</span></div><hr className="my-2 border-slate-200" /><div className="flex justify-between items-baseline"><span className="font-bold text-slate-600">Net Flow</span><span className={`font-bold text-xl ${summary.netFlow >= 0 ? 'text-green-600' : 'text-red-600'}`}>{currencyFormatter.format(summary.netFlow)}</span></div></div></div>
        </div>

        <div className="bg-white rounded-xl shadow-md overflow-hidden">
            {isStreaming && <div className="p-4 text-center text-slate-600 font-semibold flex items-center justify-center gap-2"><div className="w-5 h-5 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>Analyzing your statement...</div>}
            
            <div className="px-4 sm:px-6 py-4 border-b border-slate-200 flex items-center justify-between min-h-[64px]">
                {selectedTxIds.size > 0 ? (
                    <div className="flex items-center gap-2 sm:gap-4 animate-fade-in-fast w-full flex-wrap">
                        <span className="font-semibold text-indigo-600">{selectedTxIds.size} selected</span>
                        <div className="w-full sm:w-64">
                          <SearchableAccountSelect accounts={accounts} value={bulkAssignAccountCode} onChange={setBulkAssignAccountCode} placeholder="Assign to account..."/>
                        </div>
                        <button onClick={handleBulkAssign} disabled={!bulkAssignAccountCode} className="bg-indigo-600 text-white font-semibold py-1.5 px-4 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed">Apply</button>
                        <button onClick={() => setSelectedTxIds(new Set())} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
                    </div>
                ) : (
                    <div className="flex items-center gap-2">
                        <input id="selectAll" ref={selectAllCheckboxRef} type="checkbox" className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500" onChange={handleSelectAllVisible} aria-label="Select all visible transactions" />
                        <label htmlFor="selectAll" className="text-sm text-slate-600 select-none">Select All Visible</label>
                    </div>
                )}
            </div>

            {/* Desktop Table View */}
            <div className="overflow-x-auto hidden lg:block">
                <table className="w-full text-sm text-left text-slate-500">
                    <thead className="text-xs text-slate-700 uppercase bg-slate-100">
                        <tr>
                            <th className="px-4 py-3 w-12"></th>
                            <SortableHeader label="Date" sortKey="date" />
                            <SortableHeader label="Description" sortKey="description" />
                            <SortableHeader label="Amount" sortKey="amount" />
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3 w-64">Account</th>
                            <th className="px-4 py-3">Notes</th>
                            <th className="px-4 py-3">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        {filteredAndSortedTransactions.map(tx => (
                            <tr key={tx.id} className={`border-b transition-colors ${selectedTxIds.has(tx.id) ? 'bg-indigo-50' : 'bg-white hover:bg-slate-50'}`}>
                                <td className="px-4 py-3 w-12 text-center">
                                    <input type="checkbox" className="rounded border-slate-400 text-indigo-600 focus:ring-indigo-500" checked={selectedTxIds.has(tx.id)} onChange={() => handleSelectTx(tx.id)} aria-label={`Select transaction ${tx.id}`} />
                                </td>
                                <td className="px-4 py-3 font-medium text-slate-900 whitespace-nowrap">{tx.date}</td>
                                <td className="px-4 py-3 max-w-sm truncate" title={tx.description}>{tx.description}</td>
                                <td className={`px-4 py-3 font-semibold whitespace-nowrap ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>{currencyFormatter.format(tx.amount)}</td>
                                <td className="px-4 py-3"><span className={`px-2 py-1 text-xs font-semibold rounded-full ${tx.type === 'debit' ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>{tx.type}</span></td>
                                <td className="px-4 py-3">
                                    <div className="flex items-center gap-1">
                                        <SearchableAccountSelect accounts={accounts} value={tx.accountCode} onChange={(code) => handleUpdateTransactionAccountCode(tx.id, code)} />
                                        <button onClick={() => handleSuggestAccount(tx.id)} disabled={suggestingForTxId === tx.id || isLimitReached} className="p-1.5 text-slate-500 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed" title={isLimitReached ? "Daily AI usage limit reached" : "Get AI suggestion"}>
                                            {suggestingForTxId === tx.id ? <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div> : <SparklesIcon className="w-4 h-4" />}
                                        </button>
                                    </div>
                                </td>
                                <td className="px-4 py-3 whitespace-nowrap"><button onClick={() => setEditingTransactionForNote(tx)} className={`px-2 py-1 rounded ${tx.notes ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'text-slate-500 hover:bg-slate-200'}`}>{tx.notes ? 'View/Edit' : 'Add Note'}</button></td>
                                <td className="px-4 py-3">
                                    {tx.reconciledWith ? (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">Reconciled</span>
                                    ) : (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">Unreconciled</span>
                                    )}
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>

            {/* Mobile Card View */}
            <div className="lg:hidden space-y-3 p-3 bg-slate-50">
                {filteredAndSortedTransactions.map(tx => (
                    <div key={tx.id} className={`bg-white rounded-lg shadow-sm border p-4 space-y-3 transition-colors ${selectedTxIds.has(tx.id) ? 'border-indigo-400 ring-2 ring-indigo-200' : 'border-slate-200'}`}>
                        <div className="flex items-start justify-between">
                            <div className="flex items-center gap-3">
                                <input type="checkbox" className="mt-1 rounded border-slate-400 text-indigo-600 focus:ring-indigo-500" checked={selectedTxIds.has(tx.id)} onChange={() => handleSelectTx(tx.id)} aria-label={`Select transaction ${tx.id}`} />
                                <div>
                                    <p className="font-medium text-slate-900">{tx.date}</p>
                                    <p className={`font-semibold text-lg ${tx.type === 'debit' ? 'text-red-600' : 'text-green-600'}`}>{currencyFormatter.format(tx.amount)}</p>
                                </div>
                            </div>
                            {tx.reconciledWith ? (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">Reconciled</span>
                            ) : (
                                <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">Unreconciled</span>
                            )}
                        </div>
                        <p className="text-sm text-slate-600" title={tx.description}>{tx.description}</p>
                        <div>
                             <label className="text-xs font-medium text-slate-500">Account</label>
                             <div className="flex items-center gap-1 mt-1">
                                <SearchableAccountSelect accounts={accounts} value={tx.accountCode} onChange={(code) => handleUpdateTransactionAccountCode(tx.id, code)} />
                                <button onClick={() => handleSuggestAccount(tx.id)} disabled={suggestingForTxId === tx.id || isLimitReached} className="p-1.5 text-slate-500 hover:text-indigo-600 disabled:opacity-50 disabled:cursor-not-allowed" title={isLimitReached ? "Daily AI usage limit reached" : "Get AI suggestion"}>
                                    {suggestingForTxId === tx.id ? <div className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div> : <SparklesIcon className="w-4 h-4" />}
                                </button>
                            </div>
                        </div>
                        <button onClick={() => setEditingTransactionForNote(tx)} className={`w-full text-center mt-2 px-2 py-1.5 rounded text-sm ${tx.notes ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{tx.notes ? 'View/Edit Note' : 'Add Note'}</button>
                    </div>
                ))}
            </div>

            {transactions.length > 0 && filteredAndSortedTransactions.length === 0 && <p className="p-4 text-center text-slate-500">No transactions match your current filters.</p>}
            {transactions.length === 0 && !isStreaming && <p className="p-4 text-center text-slate-500">No statement uploaded or no transactions found.</p>}
        </div>
        </>
    );

    const renderCashbookView = () => {
        const CashbookSortableHeader = ({ label, sortKey }: { label: string, sortKey: CashbookSortKey }) => (
            <th className="px-4 py-3 cursor-pointer select-none group" onClick={() => requestCashbookSort(sortKey)}>
                <div className="flex items-center">
                    <span>{label}</span>
                    <ArrowUpDownIcon className={`w-4 h-4 ml-1.5 transition-opacity ${cashbookSortConfig.key === sortKey ? 'opacity-100' : 'opacity-30 group-hover:opacity-100'}`} direction={cashbookSortConfig.key === sortKey ? cashbookSortConfig.direction : 'none'} />
                </div>
            </th>
        );

        const CashbookTableContent = (
            <div className={`bg-white p-6 rounded-xl shadow-md flex flex-col ${isCashbookFullscreen ? 'h-full' : ''}`}>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                   <h2 className="text-xl font-semibold text-slate-700">Saved Cashbook Entries</h2>
                    <div className="flex items-center gap-2">
                        <button onClick={handleExportCashbookCSV} disabled={cashbookEntries.length === 0} className="bg-green-600 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-green-700 flex items-center gap-2 disabled:bg-slate-400">
                            <DownloadIcon className="w-5 h-5" /> Export to CSV
                        </button>
                        <button 
                            onClick={() => setIsCashbookFullscreen(prev => !prev)} 
                            className="p-2 text-slate-500 hover:text-teal-600 transition-colors"
                            title={isCashbookFullscreen ? 'Exit Fullscreen' : 'View Fullscreen'}
                        >
                            {isCashbookFullscreen ? <ArrowsPointingInIcon className="w-5 h-5" /> : <ArrowsPointingOutIcon className="w-5 h-5" />}
                        </button>
                    </div>
               </div>
                <div className={`overflow-x-auto border rounded-lg hidden lg:block ${isCashbookFullscreen ? 'flex-grow' : 'h-[calc(100vh-18rem)]'}`}>
                   <table className="w-full text-sm text-left text-slate-500">
                       <thead className="text-xs text-slate-700 uppercase bg-slate-100 sticky top-0">
                           <tr>
                               <CashbookSortableHeader label="Date" sortKey="date" />
                               <CashbookSortableHeader label="Description" sortKey="description" />
                               <CashbookSortableHeader label="Amount" sortKey="amount" />
                               <th className="px-4 py-3">Type</th>
                               <CashbookSortableHeader label="Account" sortKey="accountId" />
                               <th className="px-4 py-3">Status</th>
                               <th className="px-4 py-3">Actions</th>
                           </tr>
                       </thead>
                        <tbody className="divide-y">
                           {sortedCashbookEntries.map(entry => (
                           <tr key={entry.id} className="bg-white hover:bg-slate-50">
                               <td className="px-4 py-3 whitespace-nowrap">{entry.date}</td>
                               <td className="px-4 py-3 max-w-xs truncate" title={entry.description}>{entry.description}</td>
                               <td className={`px-4 py-3 font-semibold whitespace-nowrap ${entry.debit > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                   {currencyFormatter.format(entry.debit > 0 ? entry.debit : entry.credit)}
                               </td>
                               <td className="px-4 py-3">
                                   <span className={`px-2 py-1 text-xs font-semibold rounded-full ${entry.debit > 0 ? 'bg-red-100 text-red-800' : 'bg-green-100 text-green-800'}`}>
                                       {entry.debit > 0 ? 'Debit' : 'Credit'}
                                   </span>
                               </td>
                               <td className="px-4 py-3 whitespace-nowrap" title={accounts.find(a => a.code === entry.accountId)?.name}>{entry.accountId}</td>
                               <td className="px-4 py-3">
                                   {entry.linkedTransactionId ? (
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">Reconciled</span>
                                            <button onClick={() => handleUnlinkCashbookEntry(entry.id)} className="text-xs font-semibold text-red-600 hover:text-red-800" title="Unlink transaction">Unlink</button>
                                        </div>
                                    ) : (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">Unreconciled</span>
                                    )}
                               </td>
                               <td className="px-4 py-3">
                                   <div className="flex items-center">
                                       <button onClick={() => setEditingCashbookNoteEntry(entry)} className="p-2 text-slate-400 hover:text-blue-600" title="View/Edit Note"><BookOpenIcon className="w-4 h-4" /></button>
                                       <button onClick={() => setEditingCashbookEntry(entry)} className="p-2 text-slate-400 hover:text-indigo-600" title="Edit Entry"><PencilIcon className="w-4 h-4" /></button>
                                       <button onClick={() => handleDeleteCashbookEntry(entry.id)} className="p-2 text-slate-400 hover:text-red-600" title="Delete Entry"><TrashIcon className="w-4 h-4" /></button>
                                   </div>
                               </td>
                           </tr>
                           ))}
                       </tbody>
                   </table>
                   {cashbookEntries.length === 0 && <p className="p-4 text-center text-slate-500">No cashbook entries saved yet.</p>}
               </div>
               {/* Mobile card view for cashbook */}
               <div className={`lg:hidden space-y-3 ${isCashbookFullscreen ? 'flex-grow overflow-y-auto p-2 -m-2' : ''}`}>
                   {sortedCashbookEntries.map(entry => (
                       <div key={entry.id} className="bg-white rounded-lg shadow-sm border border-slate-200 p-4 space-y-3">
                           <div className="flex items-start justify-between">
                               <div>
                                   <p className="font-medium text-slate-900">{entry.date}</p>
                                   <p className={`font-semibold text-lg ${entry.debit > 0 ? 'text-red-600' : 'text-green-600'}`}>
                                       {currencyFormatter.format(entry.debit > 0 ? entry.debit : entry.credit)}
                                       <span className="text-xs ml-1">({entry.debit > 0 ? 'Debit' : 'Credit'})</span>
                                   </p>
                               </div>
                               <div>
                                    {entry.linkedTransactionId ? (
                                        <div className="flex items-center gap-2">
                                            <span className="px-2 py-1 text-xs font-semibold rounded-full bg-teal-100 text-teal-800">Reconciled</span>
                                            <button onClick={() => handleUnlinkCashbookEntry(entry.id)} className="text-xs font-semibold text-red-600 hover:text-red-800">Unlink</button>
                                        </div>
                                    ) : (
                                        <span className="px-2 py-1 text-xs font-semibold rounded-full bg-slate-100 text-slate-600">Unreconciled</span>
                                    )}
                                </div>
                           </div>
                           <p className="text-sm text-slate-600" title={entry.description}>{entry.description}</p>
                           <p className="text-sm"><span className="font-medium text-slate-500">Account:</span> {entry.accountId} - {accounts.find(a => a.code === entry.accountId)?.name || 'N/A'}</p>
                           <div className="flex items-center justify-between pt-2 border-t">
                               <button onClick={() => setEditingCashbookNoteEntry(entry)} className={`px-2 py-1 rounded text-sm ${entry.notes ? 'bg-blue-100 text-blue-800 hover:bg-blue-200' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}>{entry.notes ? 'View/Edit Note' : 'Add Note'}</button>
                               <div className="flex items-center">
                                   <button onClick={() => setEditingCashbookEntry(entry)} className="p-2 text-slate-400 hover:text-indigo-600"><PencilIcon className="w-4 h-4" /></button>
                                   <button onClick={() => handleDeleteCashbookEntry(entry.id)} className="p-2 text-slate-400 hover:text-red-600"><TrashIcon className="w-4 h-4" /></button>
                               </div>
                           </div>
                       </div>
                   ))}
                   {cashbookEntries.length === 0 && <p className="p-4 text-center text-slate-500">No cashbook entries saved yet.</p>}
               </div>
            </div>
        );

        return (
            <div className={`grid grid-cols-1 ${isCashbookFullscreen ? '' : 'lg:grid-cols-2 gap-8'}`}>
                <div className={`space-y-6 ${isCashbookFullscreen ? 'hidden' : ''}`}>
                    <div className="bg-white p-6 rounded-xl shadow-md">
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-semibold text-slate-700">1. Add Source Document</h2>
                             <button onClick={handleManualAddCashbookEntry} className="text-sm font-semibold text-teal-600 hover:text-teal-800 flex items-center gap-1">
                                <PlusIcon className="w-4 h-4"/> Add Manually
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-600 mb-1">Paste memo/invoice text</label>
                                <textarea value={memoInputText} onChange={e => setMemoInputText(e.target.value)} rows={8} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500 text-sm" placeholder="Paste the full text from your source document here..."></textarea>
                                <button onClick={() => handleAnalyzeMemo({ text: memoInputText })} disabled={!memoInputText.trim() || isAnalyzingMemo || isLimitReached} className="mt-2 w-full bg-teal-600 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-teal-700 disabled:bg-slate-400 disabled:cursor-not-allowed flex items-center justify-center gap-2" title={isLimitReached ? "Daily AI usage limit reached" : ""}>
                                    {isAnalyzingMemo ? <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <SparklesIcon className="w-5 h-5" />}
                                    Analyze Text
                                </button>
                            </div>
                            <div className="text-center text-slate-500 font-semibold">OR</div>
                             <div>
                                <label className="block text-sm font-medium text-slate-600 mb-1">Upload memo/invoice file</label>
                                 <input ref={memoFileInputRef} type="file" onChange={(e) => handleAnalyzeMemo({ file: e.target.files?.[0] })} accept=".pdf" disabled={isLimitReached} className="block w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-teal-50 file:text-teal-700 hover:file:bg-teal-100 disabled:opacity-50 disabled:cursor-not-allowed" title={isLimitReached ? "Daily AI usage limit reached" : ""} />
                            </div>
                        </div>
                    </div>

                    {isAnalyzingMemo && <div className="mt-4 p-4 text-center text-slate-600 font-semibold flex items-center justify-center gap-2 bg-white rounded-xl shadow-md"><div className="w-5 h-5 border-2 border-teal-500 border-t-transparent rounded-full animate-spin"></div>Analyzing Document...</div>}
                    {memoError && <div className="mt-4 bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative" role="alert"><strong className="font-bold">Error:</strong><span className="block sm:inline ml-2">{memoError}</span></div>}

                    {currentCashbookEntry && (
                         <div className="bg-white p-6 rounded-xl shadow-md animate-fade-in-fast">
                            <h2 className="text-xl font-semibold text-slate-700 mb-4">2. Review and Save Entry</h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-sm">
                                {Object.entries(currentCashbookEntry).filter(([key]) => key !== 'id' && key !== 'linkedTransactionId').map(([key, value]) => {
                                    const field = key as keyof CashbookEntry;
                                    const isTextArea = field === 'description' || field === 'notes';
                                    return (
                                    <div key={field} className={isTextArea ? 'sm:col-span-2' : ''}>
                                        <label className="block font-medium text-slate-600 capitalize mb-1">{field.replace(/([A-Z])/g, ' $1')}</label>
                                        {field === 'accountId' ? (
                                             <SearchableAccountSelect accounts={accounts} value={value as string} onChange={code => handleUpdateCurrentCashbookEntry(field, code)} />
                                        ) : isTextArea ? (
                                            <textarea value={value as string} onChange={e => handleUpdateCurrentCashbookEntry(field, e.target.value)} rows={field === 'notes' ? 4 : 2} className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" />
                                        ) : (
                                            <input type={ (field === 'debit' || field === 'credit') ? 'number' : field === 'date' ? 'date' : 'text' }
                                                value={value as any}
                                                onChange={e => handleUpdateCurrentCashbookEntry(field, e.target.value)}
                                                className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-teal-500" />
                                        )}
                                    </div>
                                )})}
                                <div className="sm:col-span-2">
                                    <label className="block font-medium text-slate-600 mb-1">Linked Transaction</label>
                                    {currentCashbookLinkedTx ? (
                                        <div className="flex items-center justify-between p-2 pl-3 bg-slate-100 rounded-md text-sm">
                                            <div className="flex-grow min-w-0">
                                                <p className="text-slate-800 truncate font-medium" title={currentCashbookLinkedTx.description}>
                                                    {currentCashbookLinkedTx.date} - {currentCashbookLinkedTx.description}
                                                </p>
                                                <p className={`text-xs font-semibold ${currentCashbookLinkedTx.type === 'debit' ? 'text-red-500' : 'text-green-500'}`}>
                                                    {currencyFormatter.format(currentCashbookLinkedTx.amount)} ({currentCashbookLinkedTx.type})
                                                </p>
                                            </div>
                                            <button onClick={handleUnlinkTransaction} className="font-semibold text-red-600 hover:text-red-800 px-3 py-1 flex-shrink-0 ml-2">Unlink</button>
                                        </div>
                                    ) : (
                                        <button onClick={handleOpenLinkModal} className="w-full text-center py-2 px-4 border-2 border-dashed border-slate-300 rounded-md hover:border-teal-500 hover:text-teal-600 text-slate-500 transition-colors">
                                            Link to Statement Transaction
                                        </button>
                                    )}
                                </div>
                            </div>
                            <div className="mt-6 flex gap-4">
                                 <button onClick={handleSaveCashbookEntry} className="w-full bg-teal-600 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-teal-700">Save Entry</button>
                                 <button onClick={() => setCurrentCashbookEntry(null)} className="w-full bg-slate-200 text-slate-800 font-semibold py-2 px-4 rounded-lg hover:bg-slate-300">Cancel</button>
                            </div>
                         </div>
                    )}
                </div>
                 <div className={isCashbookFullscreen ? 'fixed inset-0 bg-slate-100 z-[100] p-4 sm:p-6 lg:p-8' : ''}>
                     {CashbookTableContent}
                </div>
            </div>
        );
    }
    
    return (
        <>
            <NoteEditModal transaction={editingTransactionForNote} onSave={handleSaveNote} onClose={() => setEditingTransactionForNote(null)} />
            {isSaveModalOpen && <SaveSessionModal onSave={handleSaveSession} onClose={() => setIsSaveModalOpen(false)} />}
            {isChartOfAccountsModalOpen && <ChartOfAccountsModal currentAccounts={accounts} onSave={handleSaveAccounts} onClose={() => setIsChartOfAccountsModalOpen(false)} />}
            {editingCashbookEntry && <CashbookEditModal entry={editingCashbookEntry} accounts={accounts} onSave={handleUpdateCashbookEntry} onClose={() => setEditingCashbookEntry(null)} onOpenLinkModal={handleOpenLinkModal} onUnlink={handleUnlinkTransaction} transactions={transactions} />}
            {editingCashbookNoteEntry && <CashbookNoteModal entry={editingCashbookNoteEntry} onSave={handleSaveCashbookNote} onClose={() => setEditingCashbookNoteEntry(null)} />}
            {isLinkTxModalOpen && <LinkTransactionModal unreconciledTransactions={unreconciledTransactions} onLink={handleSelectTransactionToLink} onClose={() => setIsLinkTxModalOpen(false)} />}
            <TextImproverModal isOpen={isTextImproverOpen} onClose={() => setIsTextImproverOpen(false)} />
            <AiAnalystModal
                isOpen={isAnalystModalOpen}
                onClose={() => setIsAnalystModalOpen(false)}
                data={view === 'statement' ? filteredAndSortedTransactions : sortedCashbookEntries}
                dataName={view === 'statement' ? 'transactions' : 'cashbook entries'}
            />
            
            {view === 'statement' && <FilterPanel
                isOpen={isFilterPanelOpen}
                onClose={() => setIsFilterPanelOpen(false)}
                accounts={accounts}
                clearFilters={handleClearFilters}
                filters={filters}
                setFilters={setFilters}
            />}

            <div className="min-h-screen bg-slate-100 p-4 sm:p-6 lg:p-8">
                <div className="max-w-screen-2xl mx-auto">
                    <div className={isCashbookFullscreen && view === 'cashbook' ? 'hidden' : ''}>
                        {renderHeader()}
                    </div>
                    {view === 'statement' ? renderStatementView() : renderCashbookView()}
                </div>
            </div>

            <button
                onClick={() => setIsTextImproverOpen(true)}
                className="fixed bottom-6 right-6 bg-indigo-600 text-white p-4 rounded-full shadow-lg hover:bg-indigo-700 transition-transform hover:scale-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                title="AI Text Assistant"
                aria-label="Open AI Text Assistant"
            >
                <SparklesIcon className="w-6 h-6" />
            </button>

            <style>{`@keyframes fade-in-fast { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-fast { animation: fade-in-fast 0.1s ease-out forwards; }`}</style>
        </>
    );
};

export default App;