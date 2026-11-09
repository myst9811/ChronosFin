import { useEffect, useState } from 'react';
import StatCard from '../components/common/StatCard';
import AccountForm from '../components/accounts/AccountForm';
import AccountCard from '../components/accounts/AccountCard';
import accountService from '../services/account.service';
import { Account, AccountSummary, CreateAccountRequest, UpdateAccountRequest } from '../types/api.types';
import { formatCurrency } from '../utils/formatters';

const Accounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [inactiveAccounts, setInactiveAccounts] = useState<Account[]>([]);
  const [showInactive, setShowInactive] = useState(false);
  const [summary, setSummary] = useState<AccountSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<'create' | 'edit' | null>(null);
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadData = async () => {
    const [accountsData, inactiveData, summaryData] = await Promise.all([
      accountService.getAccounts(),
      accountService.getAccounts(false),
      accountService.getAccountSummary(),
    ]);
    setAccounts(accountsData);
    setInactiveAccounts(inactiveData);
    setSummary(summaryData);
  };

  useEffect(() => {
    loadData().finally(() => setLoading(false));
  }, []);

  const handleCreate = () => {
    setEditingAccount(null);
    setFormMode('create');
  };

  const handleEdit = (account: Account) => {
    setEditingAccount(account);
    setFormMode('edit');
  };

  const handleDeactivate = async (account: Account) => {
    if (
      !window.confirm(
        `Deactivate "${account.name}"? It will be hidden from your accounts and totals, ` +
          'but its transaction history is kept. You can restore it later from "Inactive accounts".'
      )
    ) {
      return;
    }
    await accountService.deleteAccount(account.id);
    await loadData();
  };

  const handleRestore = async (account: Account) => {
    await accountService.updateAccount(account.id, { isActive: true });
    await loadData();
  };

  const handleSubmit = async (data: CreateAccountRequest | UpdateAccountRequest) => {
    setSubmitting(true);
    try {
      if (formMode === 'edit' && editingAccount) {
        await accountService.updateAccount(editingAccount.id, data as UpdateAccountRequest);
      } else {
        await accountService.createAccount(data as CreateAccountRequest);
      }
      await loadData();
      setFormMode(null);
      setEditingAccount(null);
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-ink-muted">Loading accounts...</p>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-ink">Accounts</h1>
        {!formMode && (
          <button onClick={handleCreate} className="btn-primary">
            Add Account
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        <StatCard title="Total Balance" value={formatCurrency(summary?.totalBalance ?? 0)} />
        <StatCard title="Total Accounts" value={String(summary?.totalAccounts ?? 0)} />
      </div>

      {formMode && (
        <AccountForm
          initialValues={formMode === 'edit' ? editingAccount ?? undefined : undefined}
          onSubmit={handleSubmit}
          onCancel={() => {
            setFormMode(null);
            setEditingAccount(null);
          }}
          submitting={submitting}
        />
      )}

      <div className="space-y-4">
        {accounts.length === 0 && (
          <p className="text-ink-muted">
            {inactiveAccounts.length > 0
              ? 'No active accounts. Add one or restore an inactive account below.'
              : 'No accounts yet. Add one to get started.'}
          </p>
        )}
        {accounts.map((account) => (
          <AccountCard
            key={account.id}
            account={account}
            onEdit={handleEdit}
            onDeactivate={handleDeactivate}
          />
        ))}
      </div>

      {inactiveAccounts.length > 0 && (
        <div className="space-y-4">
          <button
            onClick={() => setShowInactive((v) => !v)}
            className="text-sm font-medium text-ink-muted transition-colors hover:text-ink"
            aria-expanded={showInactive}
          >
            {showInactive ? 'Hide' : 'Show'} inactive accounts ({inactiveAccounts.length})
          </button>
          {showInactive &&
            inactiveAccounts.map((account) => (
              <AccountCard key={account.id} account={account} onRestore={handleRestore} />
            ))}
        </div>
      )}
    </div>
  );
};

export default Accounts;
