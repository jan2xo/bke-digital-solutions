CREATE TABLE "V2SpikeAlpha" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "V2SpikeAlpha_pkey" PRIMARY KEY ("id")
);
