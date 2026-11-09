import { Account } from '../../types/api.types';
import { formatCurrency } from '../../utils/formatters';

interface AccountCardProps {
  account: Account;
  onEdit?: (account: Account) => void;
  onDeactivate?: (account: Account) => void;
  onRestore?: (account: Account) => void;
}

const TYPE_LABELS: Record<string, string> = {
  CHECKING: 'Checking',
  SAVINGS: 'Savings',
  CREDIT: 'Credit',
  INVESTMENT: 'Investment',
};

const AccountCard = ({ account, onEdit, onDeactivate, onRestore }: AccountCardProps) => {
  const inactive = !account.isActive;

  return (
    <div className={`card flex items-center justify-between ${inactive ? 'opacity-70' : ''}`}>
      <div>
        <div className="flex items-center gap-2">
          <p className="font-medium text-ink">{account.name}</p>
          <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
            {TYPE_LABELS[account.type] ?? account.type}
          </span>
          {inactive && (
            <span className="rounded-full bg-ink-muted/10 px-2 py-0.5 text-xs font-medium text-ink-muted">
              Inactive
            </span>
          )}
        </div>
        {account.bankName && (
          <p className="mt-1 text-sm text-ink-muted">{account.bankName}</p>
        )}
      </div>

      <div className="flex items-center gap-4">
        <p className="text-lg font-semibold text-ink">
          {formatCurrency(account.balance, account.currency)}
        </p>
        <div className="flex gap-2">
          {inactive ? (
            onRestore && (
              <button onClick={() => onRestore(account)} className="btn-secondary">
                Restore
              </button>
            )
          ) : (
            <>
              {onEdit && (
                <button onClick={() => onEdit(account)} className="btn-secondary">
                  Edit
                </button>
              )}
              {onDeactivate && (
                <button
                  onClick={() => onDeactivate(account)}
                  className="rounded-lg px-4 py-2 font-medium text-danger transition-colors hover:bg-danger/10"
                >
                  Deactivate
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default AccountCard;
