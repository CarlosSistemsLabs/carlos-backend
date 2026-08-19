import { describe, it, expect } from 'vitest';
import { AggregateRoot } from './aggregate-root.js';
import { DomainEvent } from '@domain/events/domain-event.js';

class Registered extends DomainEvent {
  constructor(aggregateId: string) {
    super(aggregateId);
  }

  override eventName(): string {
    return 'Registered';
  }
}

interface AccountProps {
  email: string;
}

class Account extends AggregateRoot<AccountProps> {
  static register(email: string): Account {
    const account = new Account({ email });
    account.addDomainEvent(new Registered(account.id));
    return account;
  }
}

describe('AggregateRoot', () => {
  it('records domain events raised during behaviour', () => {
    const account = Account.register('user@example.com');
    expect(account.domainEvents).toHaveLength(1);
    expect(account.domainEvents[0]?.eventName()).toBe('Registered');
    expect(account.domainEvents[0]?.aggregateId).toBe(account.id);
  });

  it('pullDomainEvents returns and clears buffered events', () => {
    const account = Account.register('user@example.com');
    const events = account.pullDomainEvents();
    expect(events).toHaveLength(1);
    expect(account.domainEvents).toHaveLength(0);
  });

  it('clearDomainEvents empties the buffer', () => {
    const account = Account.register('user@example.com');
    account.clearDomainEvents();
    expect(account.domainEvents).toHaveLength(0);
  });

  it('is still an Entity with identity-based equality', () => {
    const account = Account.register('user@example.com');
    expect(account.equals(account)).toBe(true);
  });
});
