import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import * as pdfjsLib from 'pdfjs-dist';
import { Transaction, Account, Session, JournalEntry, JournalLine, ReconciledTransaction } from './types';
import { UploadIcon, TrashIcon, DownloadIcon, PlusIcon, PencilIcon, CheckIcon, XIcon, SparklesIcon, ArrowUpDownIcon, SaveIcon, BookOpenIcon, ClipboardListIcon, ArrowsPointingOutIcon, ArrowsPointingInIcon, BrainIcon, FileImportIcon, SearchIcon, FlagIcon, DocumentTextIcon, BanknotesIcon } from './components/icons';
import { getApiKey, currencyFormatter, generateUUID, safeParseJson, getErrorMessage } from './utils';


declare var XLSX: any;

const DAILY_AI_LIMIT = 50;
const UNCATEGORIZED_CODE = '0000';

const DEFAULT_ACCOUNTS: Account[] = [
    { id: 'acc-0', code: UNCATEGORIZED_CODE, name: 'Uncategorized Transactions', type: 'Suspense' },
    { id: 'acc-1', code: '1010', name: 'Primary Bank Account', type: 'Asset', isBankAccount: true },
    { id: 'acc-2', code: '4000', name: 'Sales Revenue', type: 'Revenue' },
    { id: 'acc-3', code: '5000', name: 'Cost of Goods Sold', type: 'Expense' },
    { id: 'acc-4', code: '6010', name: 'Office Supplies', type: 'Expense' },
    { id: 'acc-5', code: '6020', name: 'Rent Expense', type: 'Expense' },
    { id: 'acc-6', code: '6030', name: 'Utilities', type: 'Expense' },
    { id: 'acc-7', code: '2000', name: 'Accounts Payable', type: 'Liability' },
    { id: 'acc-8', code: '3000', name: 'Owner\'s Equity', type: 'Equity' },
];

type SortableTxKey = keyof Pick<Transaction, 'date' | 'description'> | 'debit' | 'credit';


// --- HOOKS ---

const useAiLimiter = (onError: (error: any) => void) => {
    const [usage, setUsage] = useState({ count: 0, limit: DAILY_AI_LIMIT, date: new Date().toISOString().split('T')[0] });

    const getUsage = useCallback(() => {
        try {
            const today = new Date().toISOString().split('T')[0];
            const storedUsage = localStorage.getItem('aiBookkeeper_aiUsage');
            if (storedUsage) {
                const usageData = JSON.parse(storedUsage);
                if (usageData.date === today) {
                    return { count: usageData.count, date: today };
                }
            }
            // If no stored usage or it's from a previous day, reset it.
            return { count: 0, date: today };
        } catch (e) {
            console.error("Error reading AI usage from localStorage", e);
            return { count: 0, date: new Date().toISOString().split('T')[0] };
        }
    }, []);

    useEffect(() => {
        const currentUsage = getUsage();
        setUsage(prev => ({ ...prev, count: currentUsage.count, date: currentUsage.date }));
    }, [getUsage]);

    const tryAiFeature = async (): Promise<boolean> => {
        try {
            const currentUsage = getUsage();
            if (currentUsage.count >= DAILY_AI_LIMIT) {
                throw new Error(`You have reached your daily limit of ${DAILY_AI_LIMIT} AI actions. Please try again tomorrow.`);
            }
            const newCount = currentUsage.count + 1;
            localStorage.setItem('aiBookkeeper_aiUsage', JSON.stringify({ date: currentUsage.date, count: newCount }));
            setUsage(prev => ({ ...prev, count: newCount }));
            return true;
        } catch (e: any) {
            console.error("AI Limiter Error:", e);
            onError(e);
            // Re-sync state in case of error
            const currentUsage = getUsage();
            setUsage(prev => ({ ...prev, count: currentUsage.count }));
            return false;
        }
    };

    return { usage, tryAiFeature };
};

// --- HELPER FUNCTIONS ---


// --- MODAL & UI COMPONENTS ---
const TextImproverModal = ({ isOpen, onClose, onApply, tryAiFeature, initialText = '' }: { isOpen: boolean, onClose: () => void, onApply: (text: string) => void, tryAiFeature: () => Promise<boolean>, initialText?: string }) => {
    const [inputText, setInputText] = useState(initialText);
    const [outputText, setOutputText] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');
    const [isCopied, setIsCopied] = useState(false);

    useEffect(() => {
        if(isOpen) {
            setInputText(initialText);
            setOutputText('');
            setError('');
            setIsLoading(false);
        }
    }, [isOpen, initialText]);

    const handleGenerate = async () => {
        if (!inputText.trim() || !(await tryAiFeature())) return;
        setIsLoading(true);
        setError('');
        setOutputText('');
        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const prompt = `You are an AI assistant that refines unstructured financial text into a short, clear narration suitable for an accounting ledger. Your goal is to create a concise sentence that captures the key information, such as the purpose of the payment, the recipient (bank/vendor), and the payer.
Example Input: FCMB PREMIUM FEDOZ NIGERIA LIMITED-FIPIBPSF ₦ 224,035.00
Example Output: Premium Payment to FCMB by FEDOZ LTD.
Now, process the following text:
"${inputText}"`;
            
            const response = await ai.models.generateContent({ model: "gemini-2.5-flash", contents: prompt });
            setOutputText(response.text.trim());
        } catch (err) {
            console.error("Text Improver Error:", err);
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleCopy = () => {
        navigator.clipboard.writeText(outputText);
        setIsCopied(true);
        setTimeout(() => setIsCopied(false), 2000);
    };

    const handleApply = () => {
        if (outputText) {
            onApply(outputText);
            onClose();
        }
    }

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale" onClick={e => e.stopPropagation()}>
                <div className="p-6 border-b dark:border-slate-700">
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <BrainIcon className="w-6 h-6 text-indigo-500" />
                        AI Narration Assistant
                    </h3>
                    <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">Refine transaction descriptions into clear, concise narrations.</p>
                </div>
                <div className="p-6 space-y-4">
                    <div>
                        <label htmlFor="inputText" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">Original Text</label>
                        <textarea
                            id="inputText"
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            rows={4}
                            className="w-full p-2 border border-slate-300 rounded-md focus:ring-2 focus:ring-indigo-500 text-sm bg-white dark:bg-slate-700 dark:border-slate-600 dark:placeholder-slate-400 dark:text-slate-200"
                            placeholder="Paste your raw transaction description here..."
                        />
                    </div>

                    <div className="text-center">
                        <button
                            onClick={handleGenerate}
                            disabled={isLoading || !inputText.trim()}
                            className="inline-flex items-center gap-2 bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed"
                        >
                            {isLoading ? (
                                <>
                                    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                    </svg>
                                    Analyzing...
                                </>
                            ) : (
                                <>
                                    <SparklesIcon className="w-5 h-5" />
                                    Generate Refined Narration
                                </>
                            )}
                        </button>
                    </div>

                    <div>
                        <label htmlFor="outputText" className="block text-sm font-medium text-slate-600 dark:text-slate-300 mb-1">AI Generated Narration</label>
                        <div className="relative">
                            <textarea
                                id="outputText"
                                value={outputText}
                                readOnly
                                rows={4}
                                className="w-full p-2 border border-slate-300 rounded-md bg-slate-50 text-sm dark:bg-slate-700/50 dark:border-slate-600 dark:text-slate-300"
                                placeholder="AI suggestion will appear here..."
                            />
                            {outputText && (
                                <button
                                    onClick={handleCopy}
                                    title="Copy to clipboard"
                                    className="absolute top-2 right-2 p-1.5 bg-slate-200 text-slate-600 hover:bg-indigo-100 hover:text-indigo-600 rounded-md dark:bg-slate-600 dark:text-slate-200 dark:hover:bg-indigo-500"
                                >
                                    {isCopied ? <CheckIcon className="w-4 h-4 text-green-600" /> : <ClipboardListIcon className="w-4 h-4" />}
                                </button>
                            )}
                        </div>
                    </div>
                    
                    {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md dark:bg-red-900/20 dark:text-red-400">{error}</p>}
                </div>
                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-between items-center rounded-b-lg border-t dark:border-slate-700">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700">Close</button>
                    <button onClick={handleApply} disabled={!outputText} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400">Apply Narration</button>
                </div>
                <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        </div>
    );
};

const SearchableAccountSelect = ({ accounts, value, onChange, placeholder = "Select account...", disabled = false, onSelect }: { accounts: Account[], value: string, onChange?: (id: string) => void, placeholder?: string, disabled?: boolean, onSelect?: (id: string) => void }) => {
    const [searchTerm, setSearchTerm] = useState('');
    const [isOpen, setIsOpen] = useState(false);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const selectedAccount = accounts.find(a => a.id === value);

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

    const handleSelect = (accountId: string) => {
        if(onChange) onChange(accountId);
        if(onSelect) onSelect(accountId);
        setIsOpen(false);
        setSearchTerm('');
    };
    
    const displayValue = isOpen ? searchTerm : (selectedAccount ? `${selectedAccount.code} - ${selectedAccount.name}` : '');

    return (
        <div className="relative w-full" ref={wrapperRef}>
            <div className={`border border-slate-300 dark:border-slate-600 rounded-md focus-within:ring-1 focus-within:ring-indigo-500 focus-within:border-indigo-500 flex items-center ${disabled ? 'bg-slate-100 dark:bg-slate-800 cursor-not-allowed' : 'bg-white dark:bg-slate-700'}`} >
                <input
                    type="text"
                    className="w-full border-0 focus:ring-0 p-1.5 text-sm rounded-md disabled:bg-slate-100 disabled:cursor-not-allowed bg-transparent"
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
                    disabled={disabled}
                />
                 <button type="button" onClick={() => setIsOpen(!isOpen)} className="p-1 text-slate-400 hover:text-slate-600" disabled={disabled}>
                    <svg className="w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth="1.5" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 15L12 18.75 15.75 15m-7.5-6L12 5.25 15.75 9" /></svg>
                 </button>
            </div>
            {isOpen && !disabled && (
                <ul className="absolute z-30 w-full mt-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 rounded-md shadow-lg max-h-60 overflow-y-auto">
                    {filteredAccounts.length > 0 ? filteredAccounts.map(acc => (
                        <li key={acc.id} onClick={() => handleSelect(acc.id)} className="px-3 py-2 text-sm hover:bg-indigo-50 dark:hover:bg-slate-700 cursor-pointer">
                           {acc.code} - {acc.name}
                        </li>
                    )) : <li className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">No accounts found.</li>}
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

    const handleUpdateAccount = (id: string, field: keyof Account, value: string | boolean) => {
        setAccounts(prev => prev.map(acc => acc.id === id ? { ...acc, [field]: value } : acc));
        if(errors[id] && errors[id][field as keyof typeof errors[string]]) {
            setErrors(prev => {
                const newErrors = {...prev};
                delete newErrors[id][field as keyof typeof newErrors[string]];
                if(Object.keys(newErrors[id]).length === 0) delete newErrors[id];
                return newErrors;
            })
        }
    };

    const handleAddAccount = () => {
        const newAccount: Account = { id: `new-${Date.now().toString()}`, code: '', name: '', type: '', isBankAccount: false };
        setAccounts(prev => [...prev, newAccount]);
    };

    const handleDeleteAccount = (id: string) => {
        const accToDelete = accounts.find(a => a.id === id);
        if (accToDelete?.code === UNCATEGORIZED_CODE) {
            alert(`The '${accToDelete.name}' account is essential and cannot be deleted.`);
            return;
        }
        setAccounts(prev => prev.filter(acc => acc.id !== id));
    };

    const parseAndImportData = (data: (string | number)[][]) => {
        const importedAccounts: Account[] = data.filter(row => row.length >= 3 && row[0] && row[1] && row[2]).map((row, index) => ({
            id: `imported-${Date.now()}-${index}`,
            code: String(row[0]).trim(),
            name: String(row[1]).trim(),
            type: String(row[2]).trim(),
        }));
        
        const uniqueImported = importedAccounts.filter(imp => !accounts.some(exist => exist.code === imp.code));
        setAccounts(prev => [...prev, ...uniqueImported]);
        alert(`${uniqueImported.length} new accounts imported.`);
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
                const json: (string|number)[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                parseAndImportData(json.slice(1)); // Assuming header row
            } catch (err) {
                console.error("File import error:", err);
                alert("Failed to parse the file. Please ensure it's a valid CSV or Excel file.");
            }
        };
        reader.readAsArrayBuffer(file);
        event.target.value = ''; // Reset file input
    };
    
    const handlePaste = () => {
        if (!pastedText.trim()) return;
        try {
            const rows = pastedText.trim().split('\n').map(row => row.split('\t')); // Assuming tab-separated
            parseAndImportData(rows);
            setPastedText('');
        } catch(err) {
             console.error("Paste error:", err);
             alert("Failed to parse pasted text. Please ensure it is tab-separated with columns: Code, Name, Type.");
        }
    };
    
    const validateAndSave = () => {
        const newErrors: { [id: string]: { code?: string, name?: string, type?: string } } = {};
        const seenCodes = new Set<string>();

        accounts.forEach(acc => {
            const accErrors: { code?: string, name?: string, type?: string } = {};
            if (!acc.code.trim()) accErrors.code = "Code cannot be empty.";
            if (seenCodes.has(acc.code.trim().toLowerCase())) accErrors.code = "Code must be unique.";
            if (!acc.name.trim()) accErrors.name = "Name cannot be empty.";
            if (!acc.type.trim()) accErrors.type = "Type cannot be empty.";
            
            if (Object.keys(accErrors).length > 0) {
                newErrors[acc.id] = accErrors;
            }
            if(acc.code.trim()) seenCodes.add(acc.code.trim().toLowerCase());
        });

        setErrors(newErrors);
        
        if (Object.keys(newErrors).length === 0) {
            onSave(accounts);
            onClose();
        } else {
            alert("Please fix the errors before saving.");
        }
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-5xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale flex flex-col" style={{maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b dark:border-slate-700">
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <BookOpenIcon className="w-6 h-6 text-indigo-500" />
                        Manage Chart of Accounts
                    </h3>
                </div>
                
                <div className="p-5 overflow-y-auto flex-grow">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
                        <div className="p-4 border dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                            <h4 className="font-semibold mb-2 flex items-center gap-2"><FileImportIcon className="w-5 h-5" /> Import from File</h4>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">Upload a CSV or Excel file with columns: Code, Name, Type.</p>
                            <input type="file" accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel" ref={fileInputRef} onChange={handleFileImport} className="hidden" />
                            <button onClick={() => fileInputRef.current?.click()} className="text-sm bg-white dark:bg-slate-700 dark:hover:bg-slate-600 border dark:border-slate-600 px-3 py-1 rounded-md hover:bg-slate-100">Choose File</button>
                        </div>
                        <div className="p-4 border dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/40">
                             <h4 className="font-semibold mb-2 flex items-center gap-2"><ClipboardListIcon className="w-5 h-5" /> Paste from Spreadsheet</h4>
                            <textarea value={pastedText} onChange={(e) => setPastedText(e.target.value)} rows={2} className="w-full text-xs p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600" placeholder="Paste tab-separated columns here..."></textarea>
                            <button onClick={handlePaste} className="text-sm bg-white dark:bg-slate-700 dark:hover:bg-slate-600 border dark:border-slate-600 px-3 py-1 rounded-md hover:bg-slate-100 mt-1">Import from Paste</button>
                        </div>
                    </div>

                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-700">
                                <tr>
                                    <th className="p-2 text-left font-semibold">Account Code</th>
                                    <th className="p-2 text-left font-semibold">Account Name</th>
                                    <th className="p-2 text-left font-semibold">Account Type</th>
                                    <th className="p-2 text-center font-semibold">Is Bank?</th>
                                    <th className="p-2 text-center font-semibold">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {accounts.map(acc => (
                                    <tr key={acc.id} className="border-b dark:border-slate-700">
                                        <td className="p-1.5">
                                            <input type="text" value={acc.code} onChange={e => handleUpdateAccount(acc.id, 'code', e.target.value)} className={`w-full p-1 border rounded-md text-sm ${errors[acc.id]?.code ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} bg-white dark:bg-slate-700`} />
                                            {errors[acc.id]?.code && <p className="text-xs text-red-500 mt-1">{errors[acc.id].code}</p>}
                                        </td>
                                        <td className="p-1.5">
                                            <input type="text" value={acc.name} onChange={e => handleUpdateAccount(acc.id, 'name', e.target.value)} className={`w-full p-1 border rounded-md text-sm ${errors[acc.id]?.name ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} bg-white dark:bg-slate-700`} />
                                            {errors[acc.id]?.name && <p className="text-xs text-red-500 mt-1">{errors[acc.id].name}</p>}
                                        </td>
                                        <td className="p-1.5">
                                            <input type="text" value={acc.type} onChange={e => handleUpdateAccount(acc.id, 'type', e.target.value)} className={`w-full p-1 border rounded-md text-sm ${errors[acc.id]?.type ? 'border-red-500' : 'border-slate-300 dark:border-slate-600'} bg-white dark:bg-slate-700`} />
                                            {errors[acc.id]?.type && <p className="text-xs text-red-500 mt-1">{errors[acc.id].type}</p>}
                                        </td>
                                        <td className="p-1.5 text-center">
                                            <input type="checkbox" checked={!!acc.isBankAccount} onChange={e => handleUpdateAccount(acc.id, 'isBankAccount', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"/>
                                        </td>
                                        <td className="p-1.5 text-center">
                                            <button onClick={() => handleDeleteAccount(acc.id)} className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"><TrashIcon className="w-4 h-4" /></button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    <button onClick={handleAddAccount} className="mt-4 flex items-center gap-2 text-sm text-indigo-600 font-semibold hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                        <PlusIcon className="w-4 h-4" /> Add New Account
                    </button>
                </div>
                
                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end items-center rounded-b-lg border-t dark:border-slate-700 gap-3">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700">Cancel</button>
                    <button onClick={validateAndSave} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors">Save Changes</button>
                </div>
                 <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        </div>
    );
};


const JournalEntryModal = ({ isOpen, onClose, onSave, accounts, initialEntry = null, linkedTx = null, openTextImprover, selectedBankAccountId, tryAiFeature }: { isOpen: boolean, onClose: () => void, onSave: (entry: JournalEntry) => void, accounts: Account[], initialEntry?: JournalEntry | null, linkedTx?: Transaction | null, openTextImprover: (text: string, cb: (newText: string) => void) => void, selectedBankAccountId: string, tryAiFeature: () => Promise<boolean> }) => {
    const [entry, setEntry] = useState<JournalEntry>({ id: '', date: '', description: '', refNo: '', lines: [] });
    const [memoText, setMemoText] = useState('');
    const [isAiLoading, setIsAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');

    const resetState = () => {
        setMemoText('');
        setIsAiLoading(false);
        setAiError('');
    }

    useEffect(() => {
        if (isOpen) {
            resetState();
            if (initialEntry) {
                setEntry(JSON.parse(JSON.stringify(initialEntry)));
            } else if (linkedTx && selectedBankAccountId) {
                const uncategorizedAccount = accounts.find(a => a.code === UNCATEGORIZED_CODE);
                setEntry({
                    id: generateUUID(),
                    date: linkedTx.date,
                    description: linkedTx.description,
                    refNo: '',
                    lines: [
                        { id: generateUUID(), accountId: selectedBankAccountId, debit: linkedTx.type === 'credit' ? linkedTx.amount : 0, credit: linkedTx.type === 'debit' ? linkedTx.amount : 0 },
                        { id: generateUUID(), accountId: uncategorizedAccount?.id || '', debit: linkedTx.type === 'debit' ? linkedTx.amount : 0, credit: linkedTx.type === 'credit' ? linkedTx.amount : 0 }
                    ]
                });
            } else {
                // Create a new blank entry
                const today = new Date().toISOString().split('T')[0];
                setEntry({
                    id: generateUUID(),
                    date: today,
                    description: '',
                    refNo: '',
                    lines: [
                        { id: generateUUID(), accountId: '', debit: 0, credit: 0 },
                        { id: generateUUID(), accountId: '', debit: 0, credit: 0 },
                    ]
                });
            }
        }
    }, [isOpen, initialEntry, linkedTx, selectedBankAccountId, accounts]);

    const handleGenerateFromMemo = async () => {
        if (!memoText.trim() || !await tryAiFeature()) return;

        setIsAiLoading(true);
        setAiError('');

        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const chartOfAccountsForAI = accounts.map(({ id, code, name, type }) => ({ id, code, name, type }));
            const prompt = `
You are an expert AI bookkeeper. Your task is to analyze an unstructured text memo and create a balanced, two-line journal entry.

**Context:**
- The available Chart of Accounts is provided below. You MUST use the account IDs from this list.
- One side of the entry will typically be a bank account, but you should choose the most logical accounts based on the memo.

**Instructions:**
1.  Read the user's memo and understand its financial implication (e.g., paying for supplies, receiving revenue).
2.  Create a concise, professional narration (description) for the journal entry based on the memo.
3.  Determine the correct debit and credit accounts from the provided Chart of Accounts.
4.  Extract the monetary value from the memo.
5.  Construct a balanced journal entry where the debit and credit amounts are equal.
6.  Use today's date (${new Date().toISOString().split('T')[0]}) unless a specific date is mentioned in the memo.
7.  Return the result as a single JSON object with the structure: { "date": "YYYY-MM-DD", "description": "Your summarized narration", "lines": [{ "accountId": "string", "debit": number, "credit": number }, { "accountId": "string", "debit": number, "credit": number }] }.

**Chart of Accounts (use these account IDs):**
${JSON.stringify(chartOfAccountsForAI, null, 2)}

**User's Memo to Analyze:**
"${memoText}"
`;
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });

            const aiResult = safeParseJson(response.text);
            if (!aiResult.date || !aiResult.description || !Array.isArray(aiResult.lines) || aiResult.lines.length === 0) {
                throw new Error("AI returned an incomplete or malformed journal entry object.");
            }

            setEntry(prev => ({
                ...prev,
                date: aiResult.date,
                description: aiResult.description,
                lines: aiResult.lines.map((line: any) => ({
                    id: generateUUID(),
                    accountId: line.accountId,
                    debit: Number(line.debit || 0),
                    credit: Number(line.credit || 0),
                }))
            }));

        } catch (err) {
            console.error("AI Memo-to-Journal Error:", err);
            setAiError(getErrorMessage(err));
        } finally {
            setIsAiLoading(false);
        }
    };

    const handleUpdateHeader = (field: 'date' | 'description' | 'refNo', value: string) => {
        setEntry(prev => ({ ...prev, [field]: value }));
    };

    const handleUpdateLine = (lineId: string, field: keyof JournalLine, value: any) => {
        setEntry(prev => ({
            ...prev,
            lines: prev.lines.map(line => {
                if (line.id !== lineId) return line;
                const updatedLine = { ...line, [field]: value };
                if (field === 'debit' && value > 0) updatedLine.credit = 0;
                if (field === 'credit' && value > 0) updatedLine.debit = 0;
                return updatedLine;
            })
        }));
    };

    const handleAddLine = () => {
        setEntry(prev => ({ ...prev, lines: [...prev.lines, { id: generateUUID(), accountId: '', debit: 0, credit: 0 }] }));
    };

    const handleDeleteLine = (lineId: string) => {
        if (entry.lines.length <= 2) {
            alert("A journal entry must have at least two lines.");
            return;
        }
        setEntry(prev => ({ ...prev, lines: prev.lines.filter(line => line.id !== lineId) }));
    };

    const totals = useMemo(() => {
        return entry.lines.reduce((acc, line) => ({
            debit: acc.debit + Number(line.debit || 0),
            credit: acc.credit + Number(line.credit || 0)
        }), { debit: 0, credit: 0 });
    }, [entry.lines]);

    const isBalanced = totals.debit.toFixed(2) === totals.credit.toFixed(2) && totals.debit > 0;

    const handleSave = () => {
        if (!isBalanced) {
            alert("Journal entry must be balanced (debits must equal credits).");
            return;
        }
        if (entry.lines.some(l => !l.accountId)) {
            alert("All journal lines must have an account selected.");
            return;
        }
        onSave(entry);
    };

    if (!isOpen) return null;

    return (
         <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-4xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale flex flex-col" style={{maxHeight: '90vh'}} onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b dark:border-slate-700">
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <ClipboardListIcon className="w-6 h-6 text-indigo-500" />
                        {initialEntry ? 'Edit' : 'Create'} Journal Entry
                    </h3>
                     {linkedTx && <p className="text-xs text-slate-500 mt-1">Linked to Transaction: "{linkedTx.description}"</p>}
                </div>
                
                <div className="p-5 overflow-y-auto flex-grow">
                     {!initialEntry && !linkedTx && (
                        <div className="p-4 border dark:border-slate-700 rounded-lg bg-slate-50 dark:bg-slate-900/40 mb-6">
                            <h4 className="font-semibold mb-2 flex items-center gap-2"><BrainIcon className="w-5 h-5 text-indigo-500" /> Create from Memo with AI</h4>
                            <textarea
                                value={memoText}
                                onChange={(e) => setMemoText(e.target.value)}
                                rows={3}
                                className="w-full text-sm p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600"
                                placeholder="e.g., 'Paid NGN 15,500 to Vistaprint for new business cards on May 25th'"
                            ></textarea>
                            <button onClick={handleGenerateFromMemo} disabled={isAiLoading || !memoText.trim()} className="text-sm bg-indigo-600 text-white font-semibold py-1.5 px-4 rounded-md shadow-sm hover:bg-indigo-700 mt-2 disabled:bg-slate-400 flex items-center gap-2">
                                {isAiLoading ? 'Analyzing...' : 'Generate with AI'}
                            </button>
                             {aiError && <p className="text-xs text-red-500 mt-2">{aiError}</p>}
                        </div>
                     )}

                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-4">
                        <div className="md:col-span-1">
                            <label className="block text-sm font-medium mb-1">Date</label>
                            <input type="date" value={entry.date} onChange={e => handleUpdateHeader('date', e.target.value)} className="w-full text-sm p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600" />
                        </div>
                        <div className="md:col-span-1">
                            <label className="block text-sm font-medium mb-1">Ref. No (Optional)</label>
                            <input type="text" placeholder="e.g. INV-123" value={entry.refNo || ''} onChange={e => handleUpdateHeader('refNo', e.target.value)} className="w-full text-sm p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600" />
                        </div>
                        <div className="md:col-span-2">
                            <label className="block text-sm font-medium mb-1">Narration / Description</label>
                             <div className="flex items-center gap-1">
                                <textarea value={entry.description} onChange={e => handleUpdateHeader('description', e.target.value)} rows={1} className="w-full text-sm p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600" />
                                <button
                                    onClick={() => openTextImprover(entry.description, (newText) => handleUpdateHeader('description', newText))}
                                    title="Refine with AI"
                                    className="p-2 text-indigo-600 hover:bg-indigo-100 dark:text-indigo-400 dark:hover:bg-slate-700 rounded-md"
                                >
                                    <SparklesIcon className="w-5 h-5"/>
                                </button>
                            </div>
                        </div>
                    </div>
                    
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-slate-100 dark:bg-slate-700">
                                <tr>
                                    <th className="p-2 text-left font-semibold w-2/5">Account</th>
                                    <th className="p-2 text-right font-semibold">Debit</th>
                                    <th className="p-2 text-right font-semibold">Credit</th>
                                    <th className="p-2 text-center font-semibold"></th>
                                </tr>
                            </thead>
                            <tbody>
                                {entry.lines.map(line => (
                                    <tr key={line.id} className="border-b dark:border-slate-700">
                                        <td className="p-1.5"><SearchableAccountSelect accounts={accounts} value={line.accountId} onChange={accId => handleUpdateLine(line.id, 'accountId', accId)} /></td>
                                        <td className="p-1.5"><input type="number" value={line.debit || ''} onChange={e => handleUpdateLine(line.id, 'debit', parseFloat(e.target.value))} className="w-full p-1 text-right border rounded-md dark:bg-slate-700 dark:border-slate-600 font-mono" /></td>
                                        <td className="p-1.5"><input type="number" value={line.credit || ''} onChange={e => handleUpdateLine(line.id, 'credit', parseFloat(e.target.value))} className="w-full p-1 text-right border rounded-md dark:bg-slate-700 dark:border-slate-600 font-mono" /></td>
                                        <td className="p-1.5 text-center"><button onClick={() => handleDeleteLine(line.id)} className="p-1.5 text-red-500 hover:bg-red-100 rounded-full"><TrashIcon className="w-4 h-4" /></button></td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="bg-slate-50 dark:bg-slate-800/50 font-semibold">
                                    <td className="p-2 text-right">Totals</td>
                                    <td className="p-2 text-right font-mono">{currencyFormatter(totals.debit)}</td>
                                    <td className="p-2 text-right font-mono">{currencyFormatter(totals.credit)}</td>
                                    <td></td>
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <button onClick={handleAddLine} className="mt-4 flex items-center gap-2 text-sm text-indigo-600 font-semibold hover:text-indigo-800 dark:text-indigo-400 dark:hover:text-indigo-300">
                        <PlusIcon className="w-4 h-4" /> Add Line
                    </button>
                    {!isBalanced && totals.debit > 0 && <p className="mt-4 text-sm text-red-500 text-center">Debits and Credits do not match!</p>}
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end items-center rounded-b-lg border-t dark:border-slate-700 gap-3">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700">Cancel</button>
                    <button onClick={handleSave} disabled={!isBalanced} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed">Save Journal Entry</button>
                </div>
                 <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        </div>
    );
};

const PeriodManagerModal = ({ isOpen, onClose, periods, activePeriod, onSetActive, onDelete, onRename, onCreate }: {
    isOpen: boolean;
    onClose: () => void;
    periods: Session[];
    activePeriod: string;
    onSetActive: (period: string) => void;
    onDelete: (period: string) => void;
    onRename: (oldPeriod: string, newPeriod: string) => void;
    onCreate: (period: string) => void;
}) => {
    const [newPeriodInput, setNewPeriodInput] = useState(new Date().toISOString().slice(0, 7));
    const [editing, setEditing] = useState<{ old: string, new: string } | null>(null);

    if (!isOpen) return null;

    const handleCreate = () => {
        onCreate(newPeriodInput);
        setNewPeriodInput(new Date().toISOString().slice(0, 7)); // Reset
    };

    const handleSaveRename = () => {
        if (editing) {
            onRename(editing.old, editing.new);
            setEditing(null);
        }
    };
    
    const sortedPeriods = [...periods].sort((a, b) => b.period.localeCompare(a.period));

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b dark:border-slate-700">
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <BookOpenIcon className="w-6 h-6 text-indigo-500" />
                        Manage Accounting Periods
                    </h3>
                </div>

                <div className="p-5 overflow-y-auto flex-grow space-y-6">
                    <div>
                        <h4 className="font-semibold mb-2">Create New Period</h4>
                        <div className="flex gap-2">
                            <input
                                type="month"
                                value={newPeriodInput}
                                onChange={e => setNewPeriodInput(e.target.value)}
                                className="w-full p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600"
                            />
                            <button onClick={handleCreate} className="bg-indigo-600 text-white font-semibold py-2 px-4 rounded-lg shadow-sm hover:bg-indigo-700">Create</button>
                        </div>
                    </div>

                    <div>
                        <h4 className="font-semibold mb-2">Existing Periods</h4>
                        <ul className="space-y-2">
                            {sortedPeriods.map(p => (
                                <li key={p.id} className={`p-3 rounded-md flex items-center justify-between ${p.period === activePeriod ? 'bg-indigo-50 dark:bg-indigo-900/40' : 'bg-slate-50 dark:bg-slate-900/40'}`}>
                                    {editing?.old === p.period ? (
                                        <div className="flex-grow flex items-center gap-2">
                                            <input 
                                                type="text" 
                                                value={editing.new}
                                                onChange={e => setEditing({...editing, new: e.target.value})}
                                                pattern="\d{4}-\d{2}"
                                                className="w-32 p-1 border rounded-md dark:bg-slate-700 dark:border-slate-600 text-sm"
                                            />
                                            <button onClick={handleSaveRename} className="p-1.5 text-green-600 hover:bg-green-100 rounded-full"><CheckIcon className="w-4 h-4"/></button>
                                            <button onClick={() => setEditing(null)} className="p-1.5 text-slate-500 hover:bg-slate-200 rounded-full"><XIcon className="w-4 h-4"/></button>
                                        </div>
                                    ) : (
                                        <span className="font-medium">{p.period} {p.period === activePeriod && <span className="text-xs text-indigo-600 dark:text-indigo-400 font-normal">(Active)</span>}</span>
                                    )}
                                    <div className="flex items-center gap-2">
                                        {p.period !== activePeriod && <button onClick={() => onSetActive(p.period)} className="text-sm font-semibold text-indigo-600 hover:underline">Set Active</button>}
                                        <button onClick={() => setEditing({ old: p.period, new: p.period })} title="Rename" className="p-1.5 text-slate-500 hover:text-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full"><PencilIcon className="w-4 h-4"/></button>
                                        <button onClick={() => onDelete(p.period)} title="Delete" className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-100 dark:hover:bg-red-900/50 rounded-full"><TrashIcon className="w-4 h-4"/></button>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </div>
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end items-center rounded-b-lg border-t dark:border-slate-700">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700">Close</button>
                </div>
                <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        </div>
    );
};

const AiJournalEntryModal = ({ isOpen, onClose, onSave, accounts, selectedTransactions, selectedBankAccountId, tryAiFeature }: { isOpen: boolean, onClose: () => void, onSave: (entry: JournalEntry, sourceTxs: Transaction[]) => void, accounts: Account[], selectedTransactions: Transaction[], selectedBankAccountId: string, tryAiFeature: () => Promise<boolean> }) => {
    const [entry, setEntry] = useState<JournalEntry | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (isOpen) {
            generateJournalEntry();
        } else {
            setEntry(null);
            setIsLoading(false);
            setError('');
        }
    }, [isOpen]);

    const generateJournalEntry = async () => {
        if (selectedTransactions.length === 0 || !(await tryAiFeature())) {
            onClose();
            return;
        }

        setIsLoading(true);
        setError('');
        setEntry(null);

        try {
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const chartOfAccountsForAI = accounts.map(({ id, code, name, type }) => ({ id, code, name, type }));
            const transactionsForAI = selectedTransactions.map(({ date, description, amount, type }) => ({ date, description, amount, type }));
            const bankAccount = accounts.find(a => a.id === selectedBankAccountId);

            if (!bankAccount) throw new Error("Selected bank account not found in Chart of Accounts.");

            const prompt = `
You are an expert AI bookkeeper. Your task is to analyze a list of bank transactions and create a single, consolidated, and balanced journal entry.

**Context:**
- The bank account being reconciled is: "${bankAccount.code} - ${bankAccount.name}" (ID: ${bankAccount.id}).
- The available Chart of Accounts is provided below. You MUST use the account IDs from this list.
- The transactions represent activity in the specified bank account.

**Instructions:**
1.  Review the provided bank transactions.
2.  Create a single, summarized narration (description) for the journal entry that captures the essence of all transactions.
3.  Determine the appropriate offsetting accounts from the Chart of Accounts. Group similar transactions together (e.g., all office supply purchases go to one account).
4.  Construct a balanced journal entry where total debits equal total credits.
5.  One side of the entry MUST be the bank account.
6.  The date of the journal entry should be the date of the latest transaction.
7.  Return the result as a single JSON object with the following structure: { "date": "YYYY-MM-DD", "description": "Your summarized narration", "lines": [{ "accountId": "string", "debit": number, "credit": number }] }.
8.  Do NOT include the bank account line if its net effect is zero. If there are both debits and credits from the bank, create a single line for the net movement.

**Chart of Accounts (use these account IDs):**
${JSON.stringify(chartOfAccountsForAI, null, 2)}

**Bank Transactions to Analyze:**
${JSON.stringify(transactionsForAI, null, 2)}
`;
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });

            const aiResult = safeParseJson(response.text);
            if (!aiResult.date || !aiResult.description || !Array.isArray(aiResult.lines)) {
                throw new Error("AI returned an incomplete or malformed journal entry object.");
            }

            // Defensively ensure description is a string to prevent React render errors.
            const narration = typeof aiResult.description === 'string' 
                ? aiResult.description 
                : JSON.stringify(aiResult.description);

            const finalEntry: JournalEntry = {
                id: generateUUID(),
                date: aiResult.date,
                description: narration,
                lines: aiResult.lines.map((line: any) => ({
                    id: generateUUID(),
                    accountId: line.accountId,
                    debit: Number(line.debit || 0),
                    credit: Number(line.credit || 0),
                })),
            };

            const totals = finalEntry.lines.reduce((acc, line) => ({ debit: acc.debit + line.debit, credit: acc.credit + line.credit }), { debit: 0, credit: 0 });
            if (totals.debit.toFixed(2) !== totals.credit.toFixed(2)) {
                setError("Warning: The AI-generated entry is not perfectly balanced. Please review and adjust the amounts before saving.")
            }
            setEntry(finalEntry);
        } catch (err) {
            console.error("AI Journal Generation Error:", err);
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };

    const handleUpdateLine = (lineId: string, field: keyof JournalLine, value: any) => {
        if (!entry) return;
        setEntry(prev => prev && {
            ...prev,
            lines: prev.lines.map(line => {
                if (line.id !== lineId) return line;
                const updatedLine = { ...line, [field]: value };
                if (field === 'debit' && value > 0) updatedLine.credit = 0;
                if (field === 'credit' && value > 0) updatedLine.debit = 0;
                return updatedLine;
            })
        });
    };
    
    const totals = useMemo(() => {
        if (!entry) return { debit: 0, credit: 0 };
        return entry.lines.reduce((acc, line) => ({
            debit: acc.debit + Number(line.debit || 0),
            credit: acc.credit + Number(line.credit || 0)
        }), { debit: 0, credit: 0 });
    }, [entry?.lines]);

    const isBalanced = totals.debit.toFixed(2) === totals.credit.toFixed(2) && totals.debit > 0;

    const handleSave = () => {
        if (!entry || !isBalanced) return alert("Journal entry must be balanced.");
        if (entry.lines.some(l => !l.accountId)) return alert("All lines must have an account.");
        onSave(entry, selectedTransactions);
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-60 p-4" onClick={onClose}>
            <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-4xl transform transition-all duration-300 scale-95 opacity-0 animate-fade-in-scale flex flex-col" style={{ maxHeight: '90vh' }} onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b dark:border-slate-700">
                    <h3 className="text-xl font-semibold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                        <BrainIcon className="w-6 h-6 text-indigo-500" />
                        AI-Powered Journal Entry
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">AI has analyzed {selectedTransactions.length} transaction(s). Review and save.</p>
                </div>

                <div className="p-5 overflow-y-auto flex-grow">
                    {isLoading && <div className="text-center p-8">Loading AI suggestion...</div>}
                    {error && <div className="bg-red-100 text-red-700 p-3 rounded-md mb-4">{error}</div>}
                    
                    {entry && (
                        <>
                            <div className="mb-4">
                                <label className="block text-sm font-medium mb-1">Narration / Description</label>
                                <textarea value={entry.description} onChange={e => setEntry({...entry, description: e.target.value})} rows={2} className="w-full text-sm p-2 border rounded-md dark:bg-slate-700 dark:border-slate-600" />
                            </div>

                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-100 dark:bg-slate-700">
                                        <tr>
                                            <th className="p-2 text-left font-semibold w-2/5">Account</th>
                                            <th className="p-2 text-right font-semibold">Debit</th>
                                            <th className="p-2 text-right font-semibold">Credit</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {entry.lines.map(line => (
                                            <tr key={line.id} className="border-b dark:border-slate-700">
                                                <td className="p-1.5"><SearchableAccountSelect accounts={accounts} value={line.accountId} onChange={accId => handleUpdateLine(line.id, 'accountId', accId)} /></td>
                                                <td className="p-1.5"><input type="number" value={line.debit || ''} onChange={e => handleUpdateLine(line.id, 'debit', parseFloat(e.target.value))} className="w-full p-1 text-right border rounded-md dark:bg-slate-700 dark:border-slate-600 font-mono" /></td>
                                                <td className="p-1.5"><input type="number" value={line.credit || ''} onChange={e => handleUpdateLine(line.id, 'credit', parseFloat(e.target.value))} className="w-full p-1 text-right border rounded-md dark:bg-slate-700 dark:border-slate-600 font-mono" /></td>
                                            </tr>
                                        ))}
                                    </tbody>
                                    <tfoot>
                                        <tr className="bg-slate-50 dark:bg-slate-800/50 font-semibold">
                                            <td className="p-2 text-right">Totals</td>
                                            <td className="p-2 text-right font-mono">{currencyFormatter(totals.debit)}</td>
                                            <td className="p-2 text-right font-mono">{currencyFormatter(totals.credit)}</td>
                                        </tr>
                                    </tfoot>
                                </table>
                            </div>
                            {!isBalanced && totals.debit > 0 && <p className="mt-4 text-sm text-red-500 text-center">Debits and Credits do not match!</p>}
                        </>
                    )}
                </div>

                <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-4 flex justify-end items-center rounded-b-lg border-t dark:border-slate-700 gap-3">
                    <button onClick={onClose} className="text-sm font-semibold text-slate-600 hover:text-slate-800 transition-colors px-4 py-2 rounded-md hover:bg-slate-200 dark:text-slate-300 dark:hover:text-slate-100 dark:hover:bg-slate-700">Cancel</button>
                    <button onClick={handleSave} disabled={!entry || !isBalanced || isLoading} className="bg-indigo-600 text-white font-semibold py-2 px-6 rounded-lg shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed">Save Journal Entry</button>
                </div>
                 <style>{`@keyframes fade-in-scale { from { opacity: 0; transform: scale(0.95); } to { opacity: 1; transform: scale(1); } } .animate-fade-in-scale { animation: fade-in-scale 0.2s ease-out forwards; }`}</style>
            </div>
        </div>
    );
};

const App: React.FC = () => {
    // --- STATE MANAGEMENT ---
    const [statementTransactions, setStatementTransactions] = useState<Transaction[]>([]);
    const [accounts, setAccounts] = useState<Account[]>(DEFAULT_ACCOUNTS);
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
    const [reconciledTransactions, setReconciledTransactions] = useState<ReconciledTransaction[]>([]);
    
    const [periods, setPeriods] = useState<Session[]>([]);
    const [activePeriod, setActivePeriod] = useState<string>(new Date().toISOString().slice(0, 7)); // e.g. "2024-07"
    const [duplicateGroups, setDuplicateGroups] = useState<string[][]>([]);

    const [activeView, setActiveView] = useState<'statement' | 'journal'>('statement');
    const [isLoading, setIsLoading] = useState(false);
    const [loadingMessage, setLoadingMessage] = useState("Processing...");
    const [error, setError] = useState<string | null>(null);

    // Bank Statement View State
    const [selectedBankAccountId, setSelectedBankAccountId] = useState<string>('');
    const [txSortBy, setTxSortBy] = useState<SortableTxKey>('date');
    const [txSortDir, setTxSortDir] = useState<'asc' | 'desc'>('desc');
    const [selectedTx, setSelectedTx] = useState<Set<string>>(new Set());
    const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());
    const [highlightedItem, setHighlightedItem] = useState<{type: 'tx' | 'je', id: string} | null>(null);
    const [notesEdit, setNotesEdit] = useState<{id: string, text: string} | null>(null);

    // Filter States
    const [showFilters, setShowFilters] = useState(true);
    const [txSearchTerm, setTxSearchTerm] = useState('');
    const [txCategoryFilter, setTxCategoryFilter] = useState('');
    const [txStartDate, setTxStartDate] = useState('');
    const [txEndDate, setTxEndDate] = useState('');
    const [txMinAmount, setTxMinAmount] = useState('');
    const [txMaxAmount, setTxMaxAmount] = useState('');
    const [txTypeFilter, setTxTypeFilter] = useState<'all' | 'debit' | 'credit'>('all');
    const [txStatusFilter, setTxStatusFilter] = useState<'all' | 'posted' | 'unposted'>('all');
    const [jeSearchTerm, setJeSearchTerm] = useState('');


    // Modal State
    const [isCoAModalOpen, setIsCoAModalOpen] = useState(false);
    const [isJournalModalOpen, setIsJournalModalOpen] = useState(false);
    const [editingJournal, setEditingJournal] = useState<JournalEntry | null>(null);
    const [journalLinkedTx, setJournalLinkedTx] = useState<Transaction | null>(null);
    const [isTextImproverOpen, setIsTextImproverOpen] = useState(false);
    const [textToImprove, setTextToImprove] = useState('');
    const [improverCallback, setImproverCallback] = useState<(text: string) => void>(() => () => {});
    const [isAiJournalModalOpen, setIsAiJournalModalOpen] = useState(false);
    const [isImportJournalModalOpen, setIsImportJournalModalOpen] = useState(false);
    const [isExportModalOpen, setIsExportModalOpen] = useState(false);
    const [isPeriodManagerOpen, setIsPeriodManagerOpen] = useState(false);
    const [isSummaryModalOpen, setIsSummaryModalOpen] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [isSummaryLoading, setIsSummaryLoading] = useState(false);

    const { usage, tryAiFeature } = useAiLimiter((e) => setError(getErrorMessage(e)));
    const fileInputRef = useRef<HTMLInputElement>(null);
    const highlightedRef = useRef<HTMLTableRowElement>(null);
    
    // --- EFFECTS ---
    // Load all periods from local storage on initial app load
    useEffect(() => {
        try {
            const storedPeriods = localStorage.getItem('aiBookkeeper_periods');
            if (storedPeriods) {
                const loadedPeriods = JSON.parse(storedPeriods);
                const periodsArray = Object.values(loadedPeriods) as Session[];
                setPeriods(periodsArray);
            }
        } catch (e) {
            console.error("Could not load periods from local storage.", e);
            setError("Warning: Could not load saved periods. Your previous work might be missing.");
        }
    }, []);


    // Load data for the active period whenever it changes
    useEffect(() => {
        const periodData = periods.find(p => p.period === activePeriod);
        if (periodData) {
            setAccounts(periodData.accounts);
            setJournalEntries(periodData.journalEntries);
            setReconciledTransactions(periodData.reconciledTransactions || []);
        } else {
            // New period, start with defaults
            setAccounts(DEFAULT_ACCOUNTS);
            setJournalEntries([]);
            setReconciledTransactions([]);
        }
        // Clear statement-specific state when period changes
        setStatementTransactions([]);
        setSelectedTx(new Set());
        setDuplicateGroups([]);
        setSelectedBankAccountId('');
    }, [activePeriod, periods]);


    useEffect(() => {
        if (highlightedItem && highlightedRef.current) {
            highlightedRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' });
            setTimeout(() => setHighlightedItem(null), 2500); // Remove highlight after 2.5s
        }
    }, [highlightedItem]);

    const handleFileUpload = async (file: File) => {
        if (!file || !selectedBankAccountId) {
            alert("Please select a bank account before uploading a file.");
            return;
        }
        setIsLoading(true);
        setLoadingMessage(`Reading ${file.name}...`);
        setError(null);
        setDuplicateGroups([]);

        const reader = new FileReader();
        reader.onload = async (e) => {
            try {
                const fileBuffer = e.target?.result as ArrayBuffer;
                if (file.type.includes('pdf')) {
                    await parsePdf(fileBuffer);
                } else {
                    await parseSpreadsheet(fileBuffer);
                }
            } catch (err) {
                console.error("File processing error:", err);
                setError(getErrorMessage(err));
                setIsLoading(false);
            }
        };
        reader.readAsArrayBuffer(file);
    };
    
    const processAndSetTransactions = (parsedTxs: any[]) => {
        const reconciledIds = new Set(reconciledTransactions.map(rt => rt.id));
        
        const newTransactions: Transaction[] = parsedTxs.map((tx: any) => {
             // Sanitize amount
            const amount = Math.abs(parseFloat(String(tx.debit || tx.credit || 0)));

            // Sanitize type
            const type: 'debit' | 'credit' = (tx.debit && amount > 0) ? 'debit' : 'credit';

            // Sanitize date
            let date: string;
            if (tx.date && typeof tx.date === 'string' && tx.date.match(/^\d{4}-\d{2}-\d{2}/)) {
                date = tx.date;
            } else if (tx.date) {
                try {
                    date = new Date(tx.date).toISOString().split('T')[0];
                } catch {
                    date = new Date().toISOString().split('T')[0];
                }
            } else {
                date = new Date().toISOString().split('T')[0];
            }
            
            // Robustly handle description to ensure it's always a string
            let description: string;
            const rawDescription = tx.description;
            if (typeof rawDescription === 'string') {
                description = rawDescription.trim();
            } else if (rawDescription === null || typeof rawDescription === 'undefined') {
                description = 'N/A';
            } else {
                try {
                    description = JSON.stringify(rawDescription);
                } catch (e) {
                    description = '[Unserializable Content]';
                }
            }
            
            const id = `${date}-${description}-${amount}-${type}`;
            // Fix: Explicitly type the reconciliationStatus to prevent TypeScript from inferring a broad 'string' type.
            const reconciliationStatus: 'posted' | 'unposted' = reconciledIds.has(id) ? 'posted' : 'unposted';

            return {
                id,
                date,
                description,
                amount,
                type,
                reconciliationStatus: reconciliationStatus,
            }
        }).filter(tx => !isNaN(tx.amount)); // Filter out transactions where amount couldn't be parsed

        setStatementTransactions(newTransactions);
        setIsLoading(false);
    };
    
    const parsePdf = async (fileBuffer: ArrayBuffer) => {
        if (!(await tryAiFeature())) {
            setIsLoading(false);
            return;
        }

        try {
            setLoadingMessage("Extracting text from PDF...");
            // Set worker source. It's crucial for performance and to avoid issues in some environments.
            pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@4.4.168/build/pdf.worker.min.mjs`;

            const pdfDoc = await pdfjsLib.getDocument({ data: fileBuffer }).promise;
            let fullText = '';
            for (let i = 1; i <= pdfDoc.numPages; i++) {
                const page = await pdfDoc.getPage(i);
                const textContent = await page.getTextContent();
                fullText += textContent.items.map((item: any) => (item as {str: string}).str).join(' ') + '\n';
            }

            setLoadingMessage("AI is analyzing statement...");
            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            
            const prompt = `Extract structured transaction data from the following bank statement text. For each transaction, provide the date, description, and either a debit or credit amount. Ignore balance columns. Format the output as a JSON array of objects. Each object should have keys: "date" (YYYY-MM-DD), "description", "debit" (as a number), and "credit" (as a number). If a value is not present, use null.
            Text:
            ${fullText.substring(0, 30000)}
            `;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            
            processAndSetTransactions(safeParseJson(response.text));
        } catch (err) {
            console.error("PDF Parsing Error:", err);
            setError(`Failed to process PDF. The library may have failed to load or the file is corrupted. Please check your internet connection and try again. Error: ${getErrorMessage(err)}`);
            setIsLoading(false);
        }
    };
    
    const parseSpreadsheet = async (fileBuffer: ArrayBuffer) => {
        setLoadingMessage("Parsing spreadsheet...");
        const data = new Uint8Array(fileBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];
        const json: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        if (!(await tryAiFeature())) {
             setIsLoading(false);
             return;
        }
        
        setLoadingMessage("AI is interpreting spreadsheet...");
        const headerSample = json.slice(0, 5).map(row => row.join(', ')).join('\n');
        
        const ai = new GoogleGenAI({ apiKey: getApiKey() });
        const prompt = `Based on this spreadsheet sample, identify the columns for date, description, debit, and credit. Then, extract all rows into a JSON array of objects with keys: "date", "description", "debit", "credit". Normalize dates to YY-MM-DD. Treat money withdrawn as debit and money deposited as credit.
        Sample:
        ${headerSample}
        
        Full Data (first 200 rows):
        ${json.slice(0, 200).map(row => row.join(', ')).join('\n')}
        `;
        
        const response = await ai.models.generateContent({
            model: "gemini-2.5-flash",
            contents: prompt,
            config: { responseMimeType: "application/json" }
        });

        processAndSetTransactions(safeParseJson(response.text));
    };

    const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
        e.preventDefault();
        e.stopPropagation();
        const file = e.dataTransfer.files?.[0];
        if (file) handleFileUpload(file);
    };

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) handleFileUpload(file);
        e.target.value = ''; // Reset input
    };

    const handleSort = (key: SortableTxKey) => {
        if (txSortBy === key) {
            setTxSortDir(txSortDir === 'asc' ? 'desc' : 'asc');
        } else {
            setTxSortBy(key);
            setTxSortDir('desc');
        }
    };
    
    const handleSelectTx = (id: string) => {
        setSelectedTx(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    };
    
    const handleSelectAllTx = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.checked) {
            setSelectedTx(new Set(filteredTransactions.filter(t => t.reconciliationStatus !== 'posted').map(t => t.id)));
        } else {
            setSelectedTx(new Set());
        }
    };

    const toggleRowExpansion = (txId: string) => {
        setExpandedRows(prev => {
            const newSet = new Set(prev);
            if(newSet.has(txId)) {
                newSet.delete(txId);
            } else {
                newSet.add(txId);
            }
            return newSet;
        });
    };

    const getJournalForTransaction = (txId: string): JournalEntry | undefined => {
        const reconciledTx = reconciledTransactions.find(rt => rt.id === txId);
        if (!reconciledTx) return undefined;
        return journalEntries.find(je => je.id === reconciledTx.journalEntryId);
    };

    const handleSaveNote = (txId: string) => {
        if(!notesEdit || notesEdit.id !== txId) return;
        setStatementTransactions(txs => txs.map(tx => tx.id === txId ? {...tx, notes: notesEdit.text} : tx));
        setNotesEdit(null);
    };
    
    const handleOpenJournalModal = (tx: Transaction | null, entryToEdit: JournalEntry | null = null) => {
        if (entryToEdit) {
            setEditingJournal(entryToEdit);
            const linkedReconciledTx = reconciledTransactions.find(rt => rt.journalEntryId === entryToEdit.id);
            if (linkedReconciledTx) {
                const originalTx = statementTransactions.find(st => st.id === linkedReconciledTx.id);
                setJournalLinkedTx(originalTx || null);
            } else {
                 setJournalLinkedTx(null);
            }
        } else {
            setEditingJournal(null);
            setJournalLinkedTx(tx);
        }
        setIsJournalModalOpen(true);
    };

    const handleOpenTextImprover = (text: string, callback: (newText: string) => void) => {
        setTextToImprove(text);
        setImproverCallback(() => callback);
        setIsTextImproverOpen(true);
    };
    
    const handleSaveJournal = (entry: JournalEntry) => {
        const isEditing = journalEntries.some(je => je.id === entry.id);
        if (isEditing) {
            setJournalEntries(prev => prev.map(je => je.id === entry.id ? entry : je));
        } else {
            setJournalEntries(prev => [...prev, entry]);
             if (journalLinkedTx && !reconciledTransactions.some(rt => rt.id === journalLinkedTx.id)) {
                const newRecon: ReconciledTransaction = {
                    id: journalLinkedTx.id,
                    period: activePeriod,
                    bankAccountId: selectedBankAccountId,
                    journalEntryId: entry.id,
                    originalDate: journalLinkedTx.date,
                    originalDescription: journalLinkedTx.description,
                    originalAmount: journalLinkedTx.amount,
                    originalType: journalLinkedTx.type
                };
                setReconciledTransactions(prev => [...prev, newRecon]);
                setStatementTransactions(prev => prev.map(st => 
                    st.id === journalLinkedTx.id ? { ...st, reconciliationStatus: 'posted' } : st
                ));
            }
        }
        
        setIsJournalModalOpen(false);
        setEditingJournal(null);
        setJournalLinkedTx(null);
        setIsAiJournalModalOpen(false);
    };

    const handleSaveAiJournal = (entry: JournalEntry, sourceTxs: Transaction[]) => {
        setJournalEntries(prev => [...prev, entry]);

        const newReconciledTxs: ReconciledTransaction[] = sourceTxs.map(tx => ({
            id: tx.id,
            period: activePeriod,
            bankAccountId: selectedBankAccountId,
            journalEntryId: entry.id,
            originalDate: tx.date,
            originalDescription: tx.description,
            originalAmount: tx.amount,
            originalType: tx.type
        }));
        setReconciledTransactions(prev => [...prev, ...newReconciledTxs]);
        
        const postedIds = new Set(sourceTxs.map(tx => tx.id));
        setStatementTransactions(prev => prev.map(st => 
            postedIds.has(st.id) ? { ...st, reconciliationStatus: 'posted' } : st
        ));
        
        setSelectedTx(new Set());
        setIsAiJournalModalOpen(false);
    };

    const handleDeleteJournal = (id: string) => {
        if (confirm("Are you sure you want to delete this journal entry? This will un-reconcile all linked bank transactions.")) {
            // Find all reconciled transactions linked to this journal entry ID before state updates
            const linkedReconTxs = reconciledTransactions.filter(rt => rt.journalEntryId === id);

            // Update journal entries state
            setJournalEntries(prev => prev.filter(je => je.id !== id));

            if (linkedReconTxs.length > 0) {
                const idsToUnpost = new Set(linkedReconTxs.map(rt => rt.id));
                
                // Remove the reconciled transaction records for the deleted journal
                setReconciledTransactions(prev => prev.filter(rt => rt.journalEntryId !== id));
                
                // Update the status of the original statement transactions to 'unposted'
                setStatementTransactions(prev => prev.map(st => 
                    idsToUnpost.has(st.id) ? { ...st, reconciliationStatus: 'unposted' } : st
                ));
            }
        }
    };

    const handlePostToCashbook = (txsToPost: Transaction[]) => {
        if (txsToPost.length === 0 || !selectedBankAccountId) return;

        const newJournalEntries: JournalEntry[] = [];
        const newReconciledTxs: ReconciledTransaction[] = [];
        const uncategorizedAccount = accounts.find(a => a.code === UNCATEGORIZED_CODE);

        if (!uncategorizedAccount) {
            setError("Uncategorized suspense account not found!");
            return;
        }

        txsToPost.forEach(tx => {
            if(tx.reconciliationStatus === 'posted') return;

            const newJournal: JournalEntry = {
                id: generateUUID(),
                date: tx.date,
                description: tx.description,
                lines: [
                    { id: generateUUID(), accountId: selectedBankAccountId, debit: tx.type === 'credit' ? tx.amount : 0, credit: tx.type === 'debit' ? tx.amount : 0 },
                    { id: generateUUID(), accountId: uncategorizedAccount.id, debit: tx.type === 'debit' ? tx.amount : 0, credit: tx.type === 'credit' ? tx.amount : 0 }
                ]
            };
            newJournalEntries.push(newJournal);

            const newRecon: ReconciledTransaction = {
                id: tx.id,
                period: activePeriod,
                bankAccountId: selectedBankAccountId,
                journalEntryId: newJournal.id,
                originalDate: tx.date,
                originalDescription: tx.description,
                originalAmount: tx.amount,
                originalType: tx.type
            };
            newReconciledTxs.push(newRecon);
        });
        
        setJournalEntries(prev => [...prev, ...newJournalEntries]);
        setReconciledTransactions(prev => [...prev, ...newReconciledTxs]);
        
        const postedIds = new Set(newReconciledTxs.map(rt => rt.id));
        setStatementTransactions(prev => prev.map(st => 
            postedIds.has(st.id) ? { ...st, reconciliationStatus: 'posted' } : st
        ));
        
        setSelectedTx(new Set()); // Clear selection
    };

    const handleAiJournalize = () => {
        if (selectedTx.size > 0 && selectedBankAccountId) {
            setIsAiJournalModalOpen(true);
        } else {
            alert("Please select at least one transaction and ensure a bank account is active.");
        }
    };

    const saveCurrentPeriod = async () => {
        try {
            const currentPeriodData: Omit<Session, 'id' | 'period'> = {
                timestamp: Date.now(),
                accounts,
                journalEntries,
                reconciledTransactions,
            };
            
            const storedPeriods = localStorage.getItem('aiBookkeeper_periods');
            const allPeriods = storedPeriods ? JSON.parse(storedPeriods) : {};
            
            allPeriods[activePeriod] = { ...currentPeriodData, id: activePeriod, period: activePeriod };
            
            localStorage.setItem('aiBookkeeper_periods', JSON.stringify(allPeriods));

            // Also update local state
            setPeriods(Object.values(allPeriods) as Session[]);

            alert(`Period ${activePeriod} saved locally!`);
        } catch (e) {
            console.error("Failed to save period locally", e);
            setError("Failed to save period. Your browser's local storage might be full or disabled.");
        }
    };

    
    const handleDeletePeriod = (periodToDelete: string) => {
        if(confirm(`Are you sure you want to delete the period ${periodToDelete}? This action cannot be undone.`)){
            try {
                const storedPeriods = localStorage.getItem('aiBookkeeper_periods');
                const allPeriods = storedPeriods ? JSON.parse(storedPeriods) : {};
                
                delete allPeriods[periodToDelete];
                
                localStorage.setItem('aiBookkeeper_periods', JSON.stringify(allPeriods));
                
                const updatedPeriods = Object.values(allPeriods) as Session[];
                setPeriods(updatedPeriods);

                if (activePeriod === periodToDelete) {
                     const nextPeriod = updatedPeriods.length > 0 ? updatedPeriods[0].period : new Date().toISOString().slice(0, 7);
                     setActivePeriod(nextPeriod);
                }
            } catch (e) {
                 console.error("Failed to delete period locally", e);
                 setError("Failed to delete period from local storage.");
            }
        }
    };
    
    const handleRenamePeriod = (oldPeriod: string, newPeriod: string) => {
        if (!/^\d{4}-\d{2}$/.test(newPeriod)) {
            alert("Invalid period format. Please use YYYY-MM.");
            return;
        }
        if (oldPeriod === newPeriod) return;

        try {
            const storedPeriods = localStorage.getItem('aiBookkeeper_periods');
            const allPeriods = storedPeriods ? JSON.parse(storedPeriods) : {};
            
            if (allPeriods[newPeriod]) {
                alert(`Period ${newPeriod} already exists.`);
                return;
            }

            const periodData = allPeriods[oldPeriod];
            if (!periodData) {
                alert(`Could not find data for period ${oldPeriod}.`);
                return;
            }

            periodData.id = newPeriod;
            periodData.period = newPeriod;
            allPeriods[newPeriod] = periodData;
            delete allPeriods[oldPeriod];

            localStorage.setItem('aiBookkeeper_periods', JSON.stringify(allPeriods));
            
            const updatedPeriods = Object.values(allPeriods) as Session[];
            setPeriods(updatedPeriods);
            if(activePeriod === oldPeriod) {
                setActivePeriod(newPeriod);
            }
        } catch (e) {
            console.error("Failed to rename period", e);
            setError("Failed to rename period.");
        }
    };
    
    const handleCreatePeriod = (period: string) => {
        if (!/^\d{4}-\d{2}$/.test(period)) {
            alert("Invalid period format. Please use YYYY-MM.");
            return;
        }
        if (periods.some(p => p.period === period)) {
            alert(`Period ${period} already exists.`);
            return;
        }
        setActivePeriod(period);
        setIsPeriodManagerOpen(false);
    };

    const handleExport = (options: { format: 'csv', type: 'transactions' | 'journals', startDate: string, endDate: string }) => {
        const { type, startDate, endDate } = options;
        let dataToExport: any[] = [];
        let filename = '';

        const start = new Date(startDate);
        const end = new Date(endDate);
        end.setHours(23, 59, 59, 999); // Include the whole end day

        if (type === 'transactions') {
            dataToExport = statementTransactions
                .filter(tx => {
                    const txDate = new Date(tx.date);
                    return txDate >= start && txDate <= end;
                })
                .map(tx => ({
                    Date: tx.date,
                    Description: tx.description,
                    Debit: tx.type === 'debit' ? tx.amount : '',
                    Credit: tx.type === 'credit' ? tx.amount : '',
                    Notes: tx.notes || '',
                    Status: tx.reconciliationStatus
                }));
            filename = `Transactions_${startDate}_to_${endDate}.csv`;
        } else if (type === 'journals') {
             journalEntries
                .filter(je => {
                    const jeDate = new Date(je.date);
                    return jeDate >= start && jeDate <= end;
                })
                .forEach(je => {
                    je.lines.forEach(line => {
                        const account = accounts.find(a => a.id === line.accountId);
                        dataToExport.push({
                            'Journal ID': je.id,
                            Date: je.date,
                            Narration: je.description,
                            'Account Code': account?.code || 'N/A',
                            'Account Name': account?.name || 'Unknown',
                            Debit: line.debit || '',
                            Credit: line.credit || ''
                        });
                    });
                });
            filename = `JournalEntries_${startDate}_to_${endDate}.csv`;
        }
        
        const worksheet = XLSX.utils.json_to_sheet(dataToExport);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, "Export");
        XLSX.writeFile(workbook, filename);
        setIsExportModalOpen(false);
    };

    const handleFindDuplicates = async () => {
        if (statementTransactions.length < 2 || !(await tryAiFeature())) return;
        setIsLoading(true);
        setLoadingMessage("AI is searching for duplicates...");
        setDuplicateGroups([]);
        try {
            const txDataForAI = statementTransactions.map(tx => ({
                id: tx.id,
                date: tx.date,
                description: tx.description.replace(/[^a-zA-Z0-9\s]/g, "").substring(0, 50),
                amount: tx.amount
            }));

            const ai = new GoogleGenAI({ apiKey: getApiKey() });
            const prompt = `Analyze the following list of transactions and identify potential duplicates. A duplicate is a transaction with a very similar date (within 1-2 days), the same amount, and a similar description. Group the IDs of potential duplicates together. Return the result as a JSON array of arrays, where each inner array contains the string IDs of the duplicate transactions.
            Example output: [["tx-id-1", "tx-id-5"], ["tx-id-8", "tx-id-12"]]
            Transaction Data:
            ${JSON.stringify(txDataForAI)}
            `;

            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
                config: { responseMimeType: "application/json" }
            });
            const groups = safeParseJson(response.text);
            if (Array.isArray(groups) && groups.every(g => Array.isArray(g))) {
                setDuplicateGroups(groups);
                alert(`AI found ${groups.length} potential duplicate group(s). They have been flagged in the table.`);
            } else {
                 throw new Error("AI returned an invalid format for duplicate groups.");
            }
        } catch (err) {
            console.error(err);
            setError(getErrorMessage(err));
        } finally {
            setIsLoading(false);
        }
    };
    
    const handleGenerateSummary = async () => {
        if (selectedTx.size === 0 || !(await tryAiFeature())) return;

        setIsSummaryModalOpen(true);
        setIsSummaryLoading(true);
        setSummaryContent('');

        const selectedTransactions = statementTransactions.filter(tx => selectedTx.has(tx.id));
        const ai = new GoogleGenAI({ apiKey: getApiKey() });

        const prompt = `Analyze the following transactions and generate a concise summary report in Markdown format.
        The report should include:
        - A brief overall summary sentence.
        - Total debit amount.
        - Total credit amount.
        - A bulleted list of common themes, payees, or transaction types observed.

        Transactions:
        ${JSON.stringify(selectedTransactions.map(tx => ({date: tx.date, description: tx.description, amount: tx.amount, type: tx.type})))}
        `;

        try {
            const response = await ai.models.generateContent({
                model: "gemini-2.5-flash",
                contents: prompt,
            });
            setSummaryContent(response.text);
        } catch (err) {
            setSummaryContent("Error generating summary: " + getErrorMessage(err));
        } finally {
            setIsSummaryLoading(false);
        }
    };
    
    const handleGoToTransaction = (journalId: string) => {
        const reconTx = reconciledTransactions.find(rt => rt.journalEntryId === journalId);
        if (reconTx) {
            setActiveView('statement');
            // This needs a moment for the view to switch and the component to re-render
            setTimeout(() => {
                setHighlightedItem({ type: 'tx', id: reconTx.id });
            }, 100);
        } else {
            alert("This journal entry is not linked to a specific bank transaction.");
        }
    };

    // --- MEMOIZED DATA ---
    const filteredTransactions = useMemo(() => {
        return statementTransactions
            .filter(tx => {
                 if (txTypeFilter !== 'all' && tx.type !== txTypeFilter) return false;
                 if (txSearchTerm && !tx.description.toLowerCase().includes(txSearchTerm.toLowerCase())) return false;
                 if (txMinAmount && tx.amount < parseFloat(txMinAmount)) return false;
                 if (txMaxAmount && tx.amount > parseFloat(txMaxAmount)) return false;
                 if(txStartDate && tx.date < txStartDate) return false;
                 if(txEndDate && tx.date > txEndDate) return false;

                 if (txStatusFilter !== 'all' && tx.reconciliationStatus !== txStatusFilter) return false;

                 if(txCategoryFilter) {
                    const journal = getJournalForTransaction(tx.id);
                    if(!journal || !journal.lines.some(line => line.accountId === txCategoryFilter && !accounts.find(a=>a.id === line.accountId)?.isBankAccount)) {
                        return false;
                    }
                 }
                 
                 return true;
            })
            .sort((a, b) => {
                let comparison = 0;
                switch (txSortBy) {
                    case 'date':
                        comparison = a.date.localeCompare(b.date);
                        break;
                    case 'description':
                        comparison = a.description.localeCompare(b.description);
                        break;
                    case 'debit':
                        const aDebit = a.type === 'debit' ? a.amount : -Infinity;
                        const bDebit = b.type === 'debit' ? b.amount : -Infinity;
                        comparison = bDebit - aDebit;
                        break;
                    case 'credit':
                         const aCredit = a.type === 'credit' ? a.amount : -Infinity;
                         const bCredit = b.type === 'credit' ? b.amount : -Infinity;
                         comparison = bCredit - aCredit;
                        break;
                }
                return txSortDir === 'asc' ? comparison : -comparison;
            });
    }, [statementTransactions, accounts, txTypeFilter, txStatusFilter, txSortBy, txSortDir, txSearchTerm, txCategoryFilter, txStartDate, txEndDate, txMinAmount, txMaxAmount]);

    const filteredJournalEntries = useMemo(() => {
        if (!jeSearchTerm) return journalEntries;
        const lowerCaseSearch = jeSearchTerm.toLowerCase();
        return journalEntries.filter(je => {
            if (je.description.toLowerCase().includes(lowerCaseSearch)) return true;
            return je.lines.some(line => {
                const account = accounts.find(a => a.id === line.accountId);
                return account && account.name.toLowerCase().includes(lowerCaseSearch);
            });
        });
    }, [journalEntries, jeSearchTerm, accounts]);
    
    const bankAccounts = useMemo(() => accounts.filter(a => a.isBankAccount), [accounts]);
    
    const allAvailablePeriods = useMemo(() => {
        const periodSet = new Set(periods.map(p => p.period));
        periodSet.add(activePeriod);
        // Fix: Use spread syntax for better type inference from Set to Array.
        return [...periodSet].sort((a: string, b: string) => b.localeCompare(a));
    }, [periods, activePeriod]);

    // --- RENDER ---
    const renderTransactionRow = (tx: Transaction) => {
        const isSelected = selectedTx.has(tx.id);
        const isExpanded = expandedRows.has(tx.id);
        const journal = getJournalForTransaction(tx.id);
        const hasDetails = !!journal || !!tx.notes;
        const isDuplicate = duplicateGroups.some(group => group.includes(tx.id));
        
        const statusColor = tx.reconciliationStatus === 'posted' ? 'bg-green-500' : 'bg-slate-400';

        return (
            <React.Fragment key={tx.id}>
                <tr 
                    ref={highlightedItem?.type === 'tx' && highlightedItem?.id === tx.id ? highlightedRef : null}
                    className={`border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors ${isSelected ? 'bg-indigo-50 dark:bg-indigo-900/30' : ''} ${isDuplicate ? 'bg-red-50 dark:bg-red-900/20' : ''} ${highlightedItem?.id === tx.id ? 'ring-2 ring-indigo-500 ring-inset' : ''}`}
                >
                    <td className="p-2 text-center no-expand"><input type="checkbox" checked={isSelected} onChange={() => handleSelectTx(tx.id)} className="rounded" disabled={tx.reconciliationStatus === 'posted'}/></td>
                    <td className="p-2">
                         <div className="flex items-center gap-2">
                             <span title={tx.reconciliationStatus} className={`w-2.5 h-2.5 rounded-full ${statusColor}`}></span>
                             <span className="text-xs">{tx.date}</span>
                         </div>
                    </td>
                    <td className="p-2 text-sm">{tx.description}</td>
                    <td className="p-2 text-right font-mono text-sm">{tx.type === 'debit' ? currencyFormatter(tx.amount) : '—'}</td>
                    <td className="p-2 text-right font-mono text-sm">{tx.type === 'credit' ? currencyFormatter(tx.amount) : '—'}</td>
                    <td className="p-2 text-center no-expand">
                        <div className="flex items-center justify-center gap-1">
                            {isDuplicate && <FlagIcon className="w-4 h-4 text-red-500" title="Potential Duplicate" />}
                            <button
                                onClick={() => tx.reconciliationStatus === 'posted' ? handleOpenJournalModal(tx, getJournalForTransaction(tx.id)) : handleOpenJournalModal(tx)}
                                title={tx.reconciliationStatus === 'posted' ? "Edit Journal" : "Create Journal"}
                                className="p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700"
                            >
                                {tx.reconciliationStatus === 'posted' ? <PencilIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
                            </button>
                             {hasDetails && (
                                <button onClick={() => toggleRowExpansion(tx.id)} className={`p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700 transition-transform transform ${isExpanded ? 'rotate-180' : ''}`}>
                                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                                </button>
                            )}
                        </div>
                    </td>
                </tr>
                 {isExpanded && hasDetails && (
                    <tr className="bg-slate-50 dark:bg-slate-800/20">
                        <td colSpan={6} className="p-0">
                            <div className="p-4 border-l-4 border-indigo-500">
                                {journal && (
                                     <div>
                                        <h5 className="font-semibold text-sm mb-1 flex items-center gap-1.5"><DocumentTextIcon className="w-4 h-4"/>Journal Entry <span className="font-normal text-xs text-slate-500">#{journal.id.substring(0,8)}</span></h5>
                                        <p className="text-xs text-slate-600 dark:text-slate-300 mb-2">{journal.description}</p>
                                        <table className="w-full text-xs bg-white dark:bg-slate-700/50 rounded-md overflow-hidden">
                                            <thead className="bg-slate-100 dark:bg-slate-700">
                                                <tr>
                                                    <th className="p-1.5 text-left font-medium">Account</th>
                                                    <th className="p-1.5 text-right font-medium">Debit</th>
                                                    <th className="p-1.5 text-right font-medium">Credit</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                            {journal.lines.map(line => {
                                                const acc = accounts.find(a => a.id === line.accountId);
                                                return (
                                                    <tr key={line.id} className="border-t dark:border-slate-600">
                                                        <td className="p-1.5">{acc ? `${acc.code} - ${acc.name}` : 'Unknown Account'}</td>
                                                        <td className="p-1.5 text-right font-mono">{line.debit ? currencyFormatter(line.debit) : ''}</td>
                                                        <td className="p-1.5 text-right font-mono">{line.credit ? currencyFormatter(line.credit) : ''}</td>
                                                    </tr>
                                                )
                                            })}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                                {notesEdit?.id === tx.id ? (
                                    <div className="mt-3">
                                        <h5 className="font-semibold text-sm mb-1">Notes</h5>
                                        <textarea value={notesEdit.text} onChange={(e) => setNotesEdit({...notesEdit, text: e.target.value})} className="w-full p-1 border rounded-md text-xs dark:bg-slate-700 dark:border-slate-600" rows={2}></textarea>
                                        <div className="flex gap-2 mt-1">
                                            <button onClick={() => handleSaveNote(tx.id)} className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md hover:bg-indigo-200">Save</button>
                                            <button onClick={() => setNotesEdit(null)} className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-md hover:bg-slate-200">Cancel</button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className={journal ? "mt-3" : ""}>
                                        <div className="flex items-center justify-between">
                                            <h5 className="font-semibold text-sm mb-1">Notes</h5>
                                            <button onClick={() => setNotesEdit({id: tx.id, text: tx.notes || ''})} className="text-xs text-indigo-600">{tx.notes ? 'Edit Note' : 'Add Note'}</button>
                                        </div>
                                        {tx.notes ? (
                                            <p className="text-xs text-slate-700 dark:text-slate-300 whitespace-pre-wrap">{tx.notes}</p>
                                        ) : (
                                            <p className="text-xs text-slate-400">No notes for this transaction.</p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </td>
                    </tr>
                )}
            </React.Fragment>
        )
    };
    
    // --- FINAL RENDER ---
    return (
        <div className="bg-slate-100 dark:bg-slate-900 min-h-screen text-slate-800 dark:text-slate-200 font-sans text-sm">
            <header className="bg-white dark:bg-slate-800 shadow-sm sticky top-0 z-40">
                <div className="container mx-auto px-4 py-3 flex justify-between items-center">
                    <div className="flex items-center gap-3">
                        <BanknotesIcon className="w-8 h-8 text-indigo-500" />
                        <div>
                           <h1 className="text-lg font-bold text-slate-800 dark:text-slate-100">AI Bookkeeper</h1>
                           <p className="text-xs text-slate-500 dark:text-slate-400">Your Smart Accounting Assistant</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-4">
                         <button onClick={() => setIsCoAModalOpen(true)} className="flex items-center gap-2 text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-3 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600"><BookOpenIcon className="w-4 h-4"/> Chart of Accounts</button>
                        <div className="flex items-center gap-2">
                             <div className="text-right">
                                 <div className="text-xs text-slate-500 dark:text-slate-400">Period</div>
                                <select value={activePeriod} onChange={e => setActivePeriod(e.target.value)} className="bg-transparent font-semibold border-0 focus:ring-0 p-0 text-right">
                                    {allAvailablePeriods.map(p => <option key={p} value={p}>{p}{!periods.some(per => per.period === p) ? ' (New)' : ''}</option>)}
                                </select>
                            </div>
                            <button onClick={() => setIsPeriodManagerOpen(true)} className="text-sm font-semibold text-indigo-600 hover:underline">Manage</button>
                        </div>

                         <button onClick={saveCurrentPeriod} title="Save current period to this browser" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-full text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"><SaveIcon className="w-5 h-5"/></button>
                        <div className="flex items-center gap-2 bg-indigo-50 dark:bg-indigo-900/40 text-indigo-600 dark:text-indigo-400 px-3 py-1.5 rounded-full text-xs font-medium">
                            <BrainIcon className="w-4 h-4"/>
                            <span>AI Actions Left: {usage.limit - usage.count}</span>
                        </div>
                    </div>
                </div>
            </header>

            <main className="container mx-auto p-4">
                {error && (
                    <div className="bg-red-100 border border-red-400 text-red-700 dark:bg-red-900/30 dark:border-red-600 dark:text-red-300 px-4 py-3 rounded-lg relative mb-4" role="alert">
                        <strong className="font-bold">Error: </strong>
                        <span className="block sm:inline">{error}</span>
                        <button onClick={() => setError(null)} className="absolute top-0 bottom-0 right-0 px-4 py-3"><XIcon className="w-5 h-5"/></button>
                    </div>
                )}

                {isLoading && (
                    <div className="fixed inset-0 bg-white/80 dark:bg-slate-900/80 flex items-center justify-center z-[100]">
                        <div className="text-center">
                            <svg className="animate-spin h-10 w-10 text-indigo-500 mx-auto mb-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                               <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                               <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <p className="text-lg font-semibold">{loadingMessage}</p>
                            <p className="text-slate-500 dark:text-slate-400">Please wait, this may take a moment...</p>
                        </div>
                    </div>
                 )}

                <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md">
                    <div className="p-4 border-b dark:border-slate-700 flex flex-wrap gap-4 items-center justify-between">
                         <div className="flex items-center gap-4">
                            <button onClick={() => setActiveView('statement')} className={`px-4 py-2 rounded-md font-semibold ${activeView === 'statement' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Bank Reconciliation</button>
                            <button onClick={() => setActiveView('journal')} className={`px-4 py-2 rounded-md font-semibold ${activeView === 'journal' ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300' : 'hover:bg-slate-100 dark:hover:bg-slate-700'}`}>Journal Entries</button>
                        </div>
                    </div>

                    {activeView === 'statement' && (
                        <div>
                             <div className="p-4 bg-slate-50 dark:bg-slate-900/40">
                                {statementTransactions.length === 0 ? (
                                    <div
                                        onDragOver={e => e.preventDefault()}
                                        onDrop={handleDrop}
                                        className="text-center p-8 border-2 border-dashed border-slate-300 dark:border-slate-600 rounded-lg"
                                    >
                                        <UploadIcon className="mx-auto h-12 w-12 text-slate-400" />
                                        <h3 className="mt-2 text-lg font-medium text-slate-800 dark:text-slate-200">Upload your bank statement</h3>
                                        <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Drag & drop a file here or click to select.</p>
                                        <div className="mt-6 flex items-center justify-center gap-4">
                                            <div className="w-60">
                                                <label htmlFor="bank-account-select" className="sr-only">Select Bank Account</label>
                                                <select
                                                    id="bank-account-select"
                                                    value={selectedBankAccountId}
                                                    onChange={(e) => setSelectedBankAccountId(e.target.value)}
                                                    className="w-full text-sm p-2 border border-slate-300 dark:border-slate-600 rounded-md bg-white dark:bg-slate-800 focus:ring-indigo-500 focus:border-indigo-500"
                                                >
                                                    <option value="">-- Select Bank Account --</option>
                                                    {bankAccounts.map(acc => <option key={acc.id} value={acc.id}>{acc.name}</option>)}
                                                </select>
                                            </div>
                                            <button
                                                type="button"
                                                onClick={() => fileInputRef.current?.click()}
                                                disabled={!selectedBankAccountId}
                                                className="bg-indigo-600 text-white font-semibold py-2 px-5 rounded-md shadow-sm hover:bg-indigo-700 transition-colors disabled:bg-slate-400 disabled:cursor-not-allowed"
                                            >
                                                Select File
                                            </button>
                                            <input type="file" ref={fileInputRef} onChange={handleFileSelect} className="hidden" accept=".csv, .xlsx, .xls, .pdf" />
                                        </div>
                                    </div>
                                ) : (
                                    <div>
                                        <div className="flex justify-between items-center mb-4">
                                            <h3 className="font-semibold text-lg">Bank Statement Transactions</h3>
                                            <div className="flex items-center gap-2">
                                                 <button onClick={() => handlePostToCashbook(filteredTransactions.filter(tx => selectedTx.has(tx.id)))} disabled={selectedTx.size === 0} className="text-sm bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md shadow-sm hover:bg-indigo-700 disabled:bg-slate-400">Post Selected</button>
                                                 <button onClick={handleAiJournalize} disabled={selectedTx.size === 0} className="text-sm bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md shadow-sm hover:bg-indigo-700 disabled:bg-slate-400 flex items-center gap-1.5"><BrainIcon className="w-4 h-4"/> AI Journalize</button>
                                                 <button onClick={handleFindDuplicates} className="text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-3 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center gap-1.5"><SparklesIcon className="w-4 h-4 text-indigo-500"/> Find Duplicates</button>
                                                <button onClick={handleGenerateSummary} disabled={selectedTx.size === 0} className="text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-3 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center gap-1.5 disabled:text-slate-400"><BrainIcon className="w-4 h-4"/>Summarize</button>
                                            </div>
                                        </div>

                                        <div className="p-3 border dark:border-slate-700 rounded-md bg-white dark:bg-slate-800">
                                            <div className="flex justify-between items-center mb-2">
                                                <h4 className="font-semibold">Filters</h4>
                                                <button onClick={() => setShowFilters(!showFilters)} className="text-indigo-600 dark:text-indigo-400 text-xs font-semibold">{showFilters ? 'Hide' : 'Show'}</button>
                                            </div>
                                            {showFilters && (
                                                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-xs">
                                                    <input type="text" placeholder="Search description..." value={txSearchTerm} onChange={e => setTxSearchTerm(e.target.value)} className="col-span-2 p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"/>
                                                    <input type="date" title="Start Date" value={txStartDate} onChange={e => setTxStartDate(e.target.value)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"/>
                                                    <input type="date" title="End Date" value={txEndDate} onChange={e => setTxEndDate(e.target.value)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"/>
                                                    <input type="number" placeholder="Min amount" value={txMinAmount} onChange={e => setTxMinAmount(e.target.value)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"/>
                                                    <input type="number" placeholder="Max amount" value={txMaxAmount} onChange={e => setTxMaxAmount(e.target.value)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"/>
                                                    <select value={txTypeFilter} onChange={e => setTxTypeFilter(e.target.value as any)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"><option value="all">All Types</option><option value="debit">Debit</option><option value="credit">Credit</option></select>
                                                    <select value={txStatusFilter} onChange={e => setTxStatusFilter(e.target.value as any)} className="p-1.5 border rounded-md dark:bg-slate-700 dark:border-slate-600"><option value="all">All Statuses</option><option value="posted">Posted</option><option value="unposted">Unposted</option></select>
                                                    <div className="col-span-2"><SearchableAccountSelect accounts={accounts.filter(a => !a.isBankAccount)} value={txCategoryFilter} onChange={setTxCategoryFilter} placeholder="Filter by category..."/></div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="overflow-x-auto mt-4">
                                            <table className="w-full">
                                                <thead className="bg-slate-100 dark:bg-slate-700 text-left text-xs uppercase tracking-wider">
                                                    <tr>
                                                        <th className="p-2 w-10 text-center"><input type="checkbox" onChange={handleSelectAllTx} className="rounded"/></th>
                                                        <th className="p-2 cursor-pointer" onClick={() => handleSort('date')}>Date <ArrowUpDownIcon className="inline w-3 h-3" direction={txSortBy === 'date' ? txSortDir : 'none'}/></th>
                                                        <th className="p-2 cursor-pointer w-2/5" onClick={() => handleSort('description')}>Description <ArrowUpDownIcon className="inline w-3 h-3" direction={txSortBy === 'description' ? txSortDir : 'none'}/></th>
                                                        <th className="p-2 text-right cursor-pointer" onClick={() => handleSort('debit')}>Debit <ArrowUpDownIcon className="inline w-3 h-3" direction={txSortBy === 'debit' ? txSortDir : 'none'}/></th>
                                                        <th className="p-2 text-right cursor-pointer" onClick={() => handleSort('credit')}>Credit <ArrowUpDownIcon className="inline w-3 h-3" direction={txSortBy === 'credit' ? txSortDir : 'none'}/></th>
                                                        <th className="p-2 text-center">Actions</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {filteredTransactions.map(renderTransactionRow)}
                                                </tbody>
                                            </table>
                                             {filteredTransactions.length === 0 && <p className="text-center p-8 text-slate-500">No transactions match your filters.</p>}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                     {activeView === 'journal' && (
                        <div className="p-4">
                            <div className="flex justify-between items-center mb-4">
                               <h3 className="font-semibold text-lg">Journal Entries</h3>
                               <div className="flex gap-2 items-center">
                                  <div className="relative">
                                    <input 
                                        type="text"
                                        placeholder="Search narration or account..."
                                        value={jeSearchTerm}
                                        onChange={e => setJeSearchTerm(e.target.value)}
                                        className="w-64 p-1.5 pl-8 border rounded-md dark:bg-slate-700 dark:border-slate-600 text-sm"
                                    />
                                    <SearchIcon className="w-4 h-4 absolute top-1/2 left-2.5 -translate-y-1/2 text-slate-400"/>
                                  </div>
                                   <button onClick={() => setIsImportJournalModalOpen(true)} className="text-sm bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-600 px-3 py-1 rounded-md hover:bg-slate-50 dark:hover:bg-slate-600 flex items-center gap-1.5"><FileImportIcon className="w-4 h-4"/> Import Journals</button>
                                  <button onClick={() => handleOpenJournalModal(null)} className="text-sm bg-indigo-600 text-white font-semibold py-1 px-3 rounded-md shadow-sm hover:bg-indigo-700 flex items-center gap-1.5"><PlusIcon className="w-4 h-4"/> New Entry</button>
                               </div>
                            </div>

                             <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead className="bg-slate-100 dark:bg-slate-700">
                                        <tr>
                                            <th className="p-2 text-left font-semibold">Date</th>
                                            <th className="p-2 text-left font-semibold w-1/3">Narration</th>
                                            <th className="p-2 text-left font-semibold">Accounts</th>
                                            <th className="p-2 text-right font-semibold">Amount</th>
                                            <th className="p-2 text-center font-semibold">Actions</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredJournalEntries.map(je => {
                                            const totalDebit = je.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
                                            const isReconciled = reconciledTransactions.some(rt => rt.journalEntryId === je.id);
                                            return (
                                                <tr key={je.id} className="border-b dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50">
                                                    <td className="p-2 text-xs">{je.date}</td>
                                                    <td className="p-2">
                                                        {je.description}
                                                        {je.refNo && <span className="block text-xs text-slate-500 dark:text-slate-400 mt-1">Ref: {je.refNo}</span>}
                                                    </td>
                                                    <td className="p-2 text-xs">
                                                        <ul>
                                                            {je.lines.map(line => {
                                                                const acc = accounts.find(a => a.id === line.accountId);
                                                                return <li key={line.id}>{acc?.name || 'Unknown'}</li>
                                                            })}
                                                        </ul>
                                                    </td>
                                                    <td className="p-2 text-right font-mono">{currencyFormatter(totalDebit)}</td>
                                                    <td className="p-2 text-center">
                                                         <div className="flex items-center justify-center gap-1">
                                                            {isReconciled && (
                                                                <button onClick={() => handleGoToTransaction(je.id)} title="Go to Bank Transaction" className="p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-indigo-600 dark:hover:bg-slate-700"><ArrowsPointingOutIcon className="w-4 h-4"/></button>
                                                            )}
                                                            <button onClick={() => handleOpenJournalModal(null, je)} title="Edit Journal" className="p-1 rounded-md text-slate-500 hover:bg-slate-200 hover:text-slate-800 dark:hover:bg-slate-700"><PencilIcon className="w-4 h-4"/></button>
                                                            <button onClick={() => handleDeleteJournal(je.id)} title="Delete Journal" className="p-1 rounded-md text-red-500 hover:bg-red-100 hover:text-red-700 dark:hover:bg-red-900/40"><TrashIcon className="w-4 h-4"/></button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            )
                                        })}
                                    </tbody>
                                </table>
                                 {filteredJournalEntries.length === 0 && <p className="text-center p-8 text-slate-500">No journal entries found.</p>}
                            </div>
                        </div>
                    )}
                </div>
            </main>

            {isCoAModalOpen && <ChartOfAccountsModal currentAccounts={accounts} onSave={setAccounts} onClose={() => setIsCoAModalOpen(false)} />}
            {isJournalModalOpen && <JournalEntryModal isOpen={isJournalModalOpen} onClose={() => setIsJournalModalOpen(false)} onSave={handleSaveJournal} accounts={accounts} initialEntry={editingJournal} linkedTx={journalLinkedTx} openTextImprover={handleOpenTextImprover} selectedBankAccountId={selectedBankAccountId} tryAiFeature={tryAiFeature}/>}
            {isTextImproverOpen && <TextImproverModal isOpen={isTextImproverOpen} onClose={() => setIsTextImproverOpen(false)} onApply={improverCallback} tryAiFeature={tryAiFeature} initialText={textToImprove} />}
            {isAiJournalModalOpen && <AiJournalEntryModal isOpen={isAiJournalModalOpen} onClose={() => setIsAiJournalModalOpen(false)} onSave={handleSaveAiJournal} accounts={accounts} selectedTransactions={statementTransactions.filter(tx => selectedTx.has(tx.id))} selectedBankAccountId={selectedBankAccountId} tryAiFeature={tryAiFeature} />}
            {isPeriodManagerOpen && <PeriodManagerModal isOpen={isPeriodManagerOpen} onClose={() => setIsPeriodManagerOpen(false)} periods={periods} activePeriod={activePeriod} onSetActive={setActivePeriod} onDelete={handleDeletePeriod} onRename={handleRenamePeriod} onCreate={handleCreatePeriod} />}
             {isSummaryModalOpen && (
                <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-50 p-4" onClick={() => setIsSummaryModalOpen(false)}>
                    <div className="bg-white dark:bg-slate-800 rounded-lg shadow-xl w-full max-w-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b dark:border-slate-700">
                             <h3 className="font-semibold text-lg flex items-center gap-2"><BrainIcon className="w-5 h-5"/> AI Summary</h3>
                        </div>
                        <div className="p-6 prose dark:prose-invert max-w-none max-h-[60vh] overflow-y-auto">
                           {isSummaryLoading ? <p>Generating summary...</p> : <pre className="whitespace-pre-wrap font-sans text-sm">{summaryContent}</pre>}
                        </div>
                         <div className="bg-slate-50 dark:bg-slate-900/50 px-6 py-3 flex justify-end items-center rounded-b-lg border-t dark:border-slate-700">
                            <button onClick={() => setIsSummaryModalOpen(false)} className="text-sm font-semibold px-4 py-2 rounded-md hover:bg-slate-200 dark:hover:bg-slate-700">Close</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;