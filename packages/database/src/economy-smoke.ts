import "dotenv/config";
import assert from "node:assert/strict";
import {
  EconomyError,
  activateEconomySeason,
  applyWealthTax,
  buyShopItem,
  claimRoleSalaries,
  createEconomyItem,
  createEconomySeason,
  getActiveLoan,
  getEconomyAccount,
  grantWallet,
  markOverdueEconomyLoans,
  moveBetweenWalletAndBank,
  prisma,
  refundShopPurchase,
  repayLoan,
  takeLoan,
  transferWallet,
  upsertRoleSalary
} from "./index.js";

const guildId = "900000000000000001";
const userA = "900000000000000101";
const userB = "900000000000000102";
const roleId = "900000000000000201";

async function cleanup() {
  const salaries = await prisma.economyRoleSalary.findMany({
    where: { guildId },
    select: { id: true }
  });
  const salaryIds = salaries.map((salary) => salary.id);

  if (salaryIds.length > 0) {
    await prisma.economyRoleSalaryClaim.deleteMany({
      where: { salaryId: { in: salaryIds } }
    });
  }

  await prisma.economyRoleSalary.deleteMany({ where: { guildId } });
  await prisma.economyItemInstance.deleteMany({ where: { guildId } });
  await prisma.economyItemDefinition.deleteMany({ where: { guildId } });
  await prisma.economyLoan.deleteMany({ where: { guildId } });
  await prisma.economyTransaction.deleteMany({ where: { guildId } });
  await prisma.economySeason.deleteMany({ where: { guildId } });
  await prisma.economyAccount.deleteMany({ where: { guildId } });
  await prisma.economyTreasury.deleteMany({ where: { guildId } });
}

try {
  await cleanup();

  let accountA = await grantWallet({
    guildId,
    userId: userA,
    amount: 1000n,
    type: "CI_GRANT"
  });
  assert.equal(accountA.wallet, 1000n);

  const transfer = await transferWallet({
    guildId,
    fromUserId: userA,
    toUserId: userB,
    amount: 100n,
    feeBps: 200
  });
  assert.equal(transfer.fee, 2n);

  accountA = await getEconomyAccount(guildId, userA);
  let accountB = await getEconomyAccount(guildId, userB);
  assert.equal(accountA.wallet, 898n);
  assert.equal(accountB.wallet, 100n);

  accountA = await moveBetweenWalletAndBank({
    guildId,
    userId: userA,
    amount: 200n,
    direction: "DEPOSIT"
  });
  assert.equal(accountA.wallet, 698n);
  assert.equal(accountA.bank, 200n);

  const item = await createEconomyItem({
    guildId,
    sku: "ci_collectible",
    name: "CI Collectible",
    rarity: "RARE",
    itemType: "COLLECTIBLE",
    price: 50n,
    stock: 2,
    maxPerUser: 1,
    createdBy: "ci"
  });

  const purchase = await buyShopItem({
    guildId,
    userId: userA,
    itemId: item.id
  });
  assert.equal(purchase.instance.serialNumber, 1);
  assert.equal(purchase.account.wallet, 648n);

  const refund = await refundShopPurchase({
    guildId,
    userId: userA,
    instanceId: purchase.instance.id,
    reason: "CI rollback"
  });
  assert.equal(refund.refunded, 50n);
  assert.equal(refund.account.wallet, 698n);

  const itemAfterRefund =
    await prisma.economyItemDefinition.findUniqueOrThrow({
      where: { id: item.id }
    });
  assert.equal(itemAfterRefund.stock, 2);

  await upsertRoleSalary({
    guildId,
    roleId,
    amount: 25n,
    intervalMinutes: 60,
    createdBy: "ci"
  });

  const salary = await claimRoleSalaries({
    guildId,
    userId: userA,
    roleIds: [roleId]
  });
  assert.equal(salary.total, 25n);
  assert.equal(salary.account.wallet, 723n);

  await assert.rejects(
    () =>
      claimRoleSalaries({
        guildId,
        userId: userA,
        roleIds: [roleId]
      }),
    (error: unknown) =>
      error instanceof EconomyError &&
      error.code === "SALARY_COOLDOWN"
  );

  const loan = await takeLoan({
    guildId,
    userId: userA,
    amount: 100n,
    interestBps: 1000,
    dueDays: 14,
    maxPrincipal: 5000n
  });
  assert.equal(loan.balance, 110n);

  await prisma.economyLoan.update({
    where: { id: loan.id },
    data: { dueAt: new Date(Date.now() - 60_000) }
  });
  const overdue = await markOverdueEconomyLoans(guildId);
  assert.equal(overdue.count, 1);

  const overdueLoan = await getActiveLoan(guildId, userA);
  assert.equal(overdueLoan?.status, "OVERDUE");

  const payment = await repayLoan({
    guildId,
    userId: userA,
    amount: 50n
  });
  assert.equal(payment.paid, 50n);
  assert.equal(payment.remaining, 60n);

  const tax = await applyWealthTax({
    guildId,
    rateBps: 100,
    minimumTotal: 0n,
    actorId: "ci"
  });
  assert.equal(tax.affectedAccounts, 2);
  assert.equal(tax.collected, 11n);

  accountA = await getEconomyAccount(guildId, userA);
  accountB = await getEconomyAccount(guildId, userB);
  assert.equal(accountA.wallet, 763n);
  assert.equal(accountA.bank, 200n);
  assert.equal(accountB.wallet, 99n);

  const season = await createEconomySeason({
    guildId,
    name: "CI Season",
    startsAt: new Date(),
    resetBalances: true,
    createdBy: "ci"
  });
  await activateEconomySeason(guildId, season.id);

  accountA = await getEconomyAccount(guildId, userA);
  accountB = await getEconomyAccount(guildId, userB);
  assert.equal(accountA.wallet, 0n);
  assert.equal(accountA.bank, 0n);
  assert.equal(accountB.wallet, 0n);
  assert.equal(accountB.bank, 0n);

  const treasury = await prisma.economyTreasury.findUniqueOrThrow({
    where: { guildId }
  });
  assert.equal(treasury.burned, 1062n);

  const ledgerTypes = new Set(
    (
      await prisma.economyTransaction.findMany({
        where: { guildId },
        select: { type: true }
      })
    ).map((entry) => entry.type)
  );

  for (const required of [
    "CI_GRANT",
    "TRANSFER_OUT",
    "TRANSFER_IN",
    "BANK_DEPOSIT",
    "SHOP_PURCHASE",
    "SHOP_REFUND",
    "ROLE_SALARY",
    "LOAN_DISBURSEMENT",
    "LOAN_REPAYMENT",
    "WEALTH_TAX",
    "SEASON_RESET"
  ]) {
    assert.ok(
      ledgerTypes.has(required),
      "В ledger отсутствует " + required
    );
  }

  console.log("Economy smoke-test пройден.");
} finally {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
