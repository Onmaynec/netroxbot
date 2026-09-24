import "dotenv/config";
import assert from "node:assert/strict";
import {
  buyLotteryTickets,
  buyMarketplaceListing,
  buyShopItem,
  createEconomyItem,
  createLotteryRound,
  createMarketplaceListing,
  createPvpGame,
  createUserAuction,
  getEconomyAccount,
  grantWallet,
  joinPvpGame,
  placeAuctionBid,
  prisma,
  settleAuction,
  settleLotteryRound,
  settlePvpGame
} from "./index.js";

const guildId = "910000000000000001";
const userA = "910000000000000101";
const userB = "910000000000000102";
const userC = "910000000000000103";

async function cleanup() {
  const lotteries = await prisma.economyLotteryRound.findMany({
    where: { guildId },
    select: { id: true }
  });
  const lotteryIds = lotteries.map((row) => row.id);

  if (lotteryIds.length > 0) {
    await prisma.economyLotteryTicket.deleteMany({
      where: { roundId: { in: lotteryIds } }
    });
  }

  const auctions = await prisma.economyAuction.findMany({
    where: { guildId },
    select: { id: true }
  });
  const auctionIds = auctions.map((row) => row.id);

  if (auctionIds.length > 0) {
    await prisma.economyAuctionBid.deleteMany({
      where: { auctionId: { in: auctionIds } }
    });
  }

  await prisma.economyEscrow.deleteMany({ where: { guildId } });
  await prisma.economyGameSession.deleteMany({ where: { guildId } });
  await prisma.economyLotteryRound.deleteMany({ where: { guildId } });
  await prisma.economyAuction.deleteMany({ where: { guildId } });
  await prisma.economyMarketplaceListing.deleteMany({
    where: { guildId }
  });
  await prisma.economyItemInstance.deleteMany({ where: { guildId } });
  await prisma.economyItemDefinition.deleteMany({ where: { guildId } });
  await prisma.economyTransaction.deleteMany({ where: { guildId } });
  await prisma.economyAccount.deleteMany({ where: { guildId } });
  await prisma.economyTreasury.deleteMany({ where: { guildId } });
}

try {
  await cleanup();

  await Promise.all([
    grantWallet({
      guildId,
      userId: userA,
      amount: 5000n,
      type: "TRADE_CI_GRANT"
    }),
    grantWallet({
      guildId,
      userId: userB,
      amount: 5000n,
      type: "TRADE_CI_GRANT"
    }),
    grantWallet({
      guildId,
      userId: userC,
      amount: 5000n,
      type: "TRADE_CI_GRANT"
    })
  ]);

  const marketItem = await createEconomyItem({
    guildId,
    sku: "trade_ci_market",
    name: "Trade CI Market Item",
    rarity: "EPIC",
    itemType: "COLLECTIBLE",
    price: 100n,
    stock: 1,
    createdBy: "ci"
  });
  const marketPurchase = await buyShopItem({
    guildId,
    userId: userA,
    itemId: marketItem.id
  });
  const listing = await createMarketplaceListing({
    guildId,
    sellerId: userA,
    itemInstanceId: marketPurchase.instance.id,
    price: 200n,
    feeBps: 500,
    expiresAt: new Date(Date.now() + 60_000)
  });

  const race = await Promise.allSettled([
    buyMarketplaceListing({
      guildId,
      listingId: listing.id,
      buyerId: userB
    }),
    buyMarketplaceListing({
      guildId,
      listingId: listing.id,
      buyerId: userC
    })
  ]);

  assert.equal(
    race.filter((entry) => entry.status === "fulfilled").length,
    1,
    "Один marketplace listing был куплен больше одного раза."
  );

  const soldListing =
    await prisma.economyMarketplaceListing.findUniqueOrThrow({
      where: { id: listing.id }
    });
  assert.equal(soldListing.status, "SOLD");

  const marketInstance =
    await prisma.economyItemInstance.findUniqueOrThrow({
      where: { id: marketPurchase.instance.id }
    });
  assert.equal(
    marketInstance.ownerId,
    soldListing.buyerId,
    "Владелец серийного предмета не совпал с покупателем."
  );
  assert.equal(marketInstance.lockKind, null);

  const auctionItem = await createEconomyItem({
    guildId,
    sku: "trade_ci_auction",
    name: "Trade CI Auction Item",
    rarity: "LEGENDARY",
    itemType: "COLLECTIBLE",
    price: 100n,
    stock: 1,
    createdBy: "ci"
  });
  const auctionPurchase = await buyShopItem({
    guildId,
    userId: userA,
    itemId: auctionItem.id
  });
  const startsAt = new Date();
  const auction = await createUserAuction({
    guildId,
    sellerId: userA,
    itemInstanceId: auctionPurchase.instance.id,
    startPrice: 100n,
    minIncrement: 10n,
    feeBps: 500,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 60_000)
  });

  const beforeBidB = await getEconomyAccount(guildId, userB);
  await placeAuctionBid({
    guildId,
    auctionId: auction.id,
    bidderId: userB,
    amount: 100n
  });
  await placeAuctionBid({
    guildId,
    auctionId: auction.id,
    bidderId: userC,
    amount: 120n
  });
  const afterOutbidB = await getEconomyAccount(guildId, userB);

  assert.equal(
    afterOutbidB.wallet,
    beforeBidB.wallet,
    "Перебитая ставка не вернулась предыдущему лидеру."
  );

  await prisma.economyAuction.update({
    where: { id: auction.id },
    data: { endsAt: new Date(Date.now() - 1000) }
  });
  await settleAuction(guildId, auction.id);

  const auctionInstance =
    await prisma.economyItemInstance.findUniqueOrThrow({
      where: { id: auctionPurchase.instance.id }
    });
  assert.equal(auctionInstance.ownerId, userC);
  assert.equal(auctionInstance.lockKind, null);

  const game = await createPvpGame({
    guildId,
    requestId: "trade-ci-game",
    gameType: "DICE",
    hostId: userA,
    opponentId: userB,
    stake: 50n,
    feeBps: 200,
    state: {},
    ttlSeconds: 60
  });
  await joinPvpGame({
    guildId,
    sessionId: game.id,
    userId: userB
  });
  await settlePvpGame({
    guildId,
    sessionId: game.id,
    winnerId: userA,
    reason: "ci"
  });

  const afterFirstSettle = await getEconomyAccount(guildId, userA);
  await settlePvpGame({
    guildId,
    sessionId: game.id,
    winnerId: userA,
    reason: "ci-repeat"
  });
  const afterSecondSettle = await getEconomyAccount(guildId, userA);

  assert.equal(
    afterSecondSettle.wallet,
    afterFirstSettle.wallet,
    "Повторный settle PvP повторно выплатил банк."
  );

  const round = await createLotteryRound({
    guildId,
    title: "Trade CI Lottery",
    ticketPrice: 10n,
    maxTickets: 10,
    maxTicketsPerUser: 5,
    feeBps: 500,
    startsAt: new Date(Date.now() - 1000),
    endsAt: new Date(Date.now() + 60_000),
    createdBy: "ci"
  });
  await buyLotteryTickets({
    guildId,
    roundId: round.id,
    userId: userA,
    quantity: 1
  });
  await buyLotteryTickets({
    guildId,
    roundId: round.id,
    userId: userB,
    quantity: 2
  });
  await prisma.economyLotteryRound.update({
    where: { id: round.id },
    data: { endsAt: new Date(Date.now() - 1000) }
  });
  const settledLottery = await settleLotteryRound(
    guildId,
    round.id
  );

  assert.equal(settledLottery.status, "ENDED");
  assert.ok(settledLottery.winnerId);
  assert.equal(settledLottery.pot, 30n);

  const held = await prisma.economyEscrow.count({
    where: {
      guildId,
      status: "HELD"
    }
  });
  assert.equal(
    held,
    0,
    "После завершения тестов остались зависшие HELD escrow."
  );

  console.log("Trade smoke-test пройден.");
} finally {
  await cleanup().catch(() => undefined);
  await prisma.$disconnect();
}
