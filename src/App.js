import React, { useState, useMemo, useEffect } from 'react';

const Card = ({ children }) => <div className="border rounded-xl p-4 shadow bg-white">{children}</div>;
const CardContent = ({ children, className }) => <div className={className}>{children}</div>;
const Button = ({ children, className = '', ...props }) => (
  <button
    className={`bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2 px-4 rounded ${className}`}
    {...props}
  >
    {children}
  </button>
);

const ASSETS = {
  BTC: { name: "Bitcoin", symbol: "bitcoin", volatility: 0.02 },
  ETH: { name: "Ethereum", symbol: "ethereum", volatility: 0.025 },
  SOL: { name: "Solana", symbol: "solana", volatility: 0.035 },
  LINK: { name: "Chainlink", symbol: "chainlink", volatility: 0.04 },
  DOGE: { name: "Dogecoin", symbol: "dogecoin", volatility: 0.06 }
};

const TIMEFRAMES = {
  "1-hour": 1,
  "4-hour": 4,
  "24-hour": 24,
  "48-hour": 48,
  "3-day": 72,
  "7-day": 168,
  "14-day": 336,
  "30-day": 720
};

const RANGE_LIMITS = {
  narrow: 0.01,
  wide: 0.30
};

const TREASURY_SIZE = 20000;
const MAX_PAYOUT_PERCENTAGE = 0.10;

function calculateTimeScaledVolatility(assetKey, timeframeHours, price) {
  const vol = ASSETS[assetKey].volatility;
  let multiplier = 1.0;
  if (timeframeHours <= 1) multiplier = 1.3;
  else if (timeframeHours <= 4) multiplier = 1.2;
  else if (timeframeHours <= 24) multiplier = 1.1;
  return vol * Math.sqrt(timeframeHours / 24) * multiplier;
}

function calculateWinProbability(assetKey, lowerBound, upperBound, timeframeHours, price) {
  const stdDev = price * calculateTimeScaledVolatility(assetKey, timeframeHours, price);
  const z1 = (lowerBound - price) / stdDev;
  const z2 = (upperBound - price) / stdDev;
  const normalCDF = z => 0.5 * (1 + Math.tanh(Math.sqrt(Math.PI / 8) * z));
  const probability = normalCDF(z2) - normalCDF(z1);
  return Math.min(probability, 0.25);
}

function calculatePayoutOdds(probability, houseEdge = 0.07) {
  return (1 / probability) * (1 - houseEdge);
}

function isRangeValid(lowerBound, upperBound, price) {
  const width = (upperBound - lowerBound) / price;
  return width >= RANGE_LIMITS.narrow && width <= RANGE_LIMITS.wide;
}

export default function ParlayBuilder() {
  const [legs, setLegs] = useState([]);
  const [selectedAsset, setSelectedAsset] = useState("BTC");
  const [timeframe, setTimeframe] = useState("24-hour");
  const [lowerBound, setLowerBound] = useState(0);
  const [upperBound, setUpperBound] = useState(0);
  const [betAmount, setBetAmount] = useState(100);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState("");
  const [livePrice, setLivePrice] = useState(0);

  useEffect(() => {
    async function fetchPrice() {
      try {
        const res = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ASSETS[selectedAsset].symbol}&vs_currencies=usd`);
        const data = await res.json();
        setLivePrice(data[ASSETS[selectedAsset].symbol].usd);
      } catch (err) {
        console.error("Error fetching live price", err);
        setLivePrice(0);
      }
    }
    fetchPrice();
  }, [selectedAsset]);

  const addLeg = () => {
    if (!isRangeValid(lowerBound, upperBound, livePrice)) {
      setError("Range width must be between 1% and 30% of the current asset price.");
      return;
    }
    setError("");
    const timeframeHours = TIMEFRAMES[timeframe];
    const probability = calculateWinProbability(
      selectedAsset,
      lowerBound,
      upperBound,
      timeframeHours,
      livePrice
    );
    const payoutOdds = calculatePayoutOdds(probability);
    setLegs([...legs, { asset: selectedAsset, timeframe, lowerBound, upperBound, probability, payoutOdds }]);
  };

  const removeLeg = (index) => {
    setLegs(legs.filter((_, i) => i !== index));
  };

  const getCombinedProb = () => {
    if (legs.length === 0) return 0;
    const base = legs.reduce((acc, leg) => acc * leg.probability, 1);
    const avgCorrelationFactor = 0.85;
    const bonus = legs.length === 2 ? 1.3 : legs.length === 3 ? 1.5 : 1.0;
    return Math.pow(base, 1 / legs.length) * avgCorrelationFactor * bonus;
  };

  const getCombinedPayout = () => {
    const combinedProb = getCombinedProb();
    return combinedProb > 0 ? calculatePayoutOdds(Math.min(combinedProb, 0.25)).toFixed(2) : 0;
  };

  const placeBet = () => {
    if (legs.length === 0) {
      setError("You must add at least one leg to your parlay.");
      return;
    }
    const finalProb = getCombinedProb();

    if (finalProb > 0.25) {
      setError("Combined probability exceeds 25% maximum win cap.");
      return;
    }

    const payoutOdds = calculatePayoutOdds(finalProb);
    const potentialPayout = betAmount * payoutOdds;

    if (potentialPayout > TREASURY_SIZE * MAX_PAYOUT_PERCENTAGE) {
      setError("Potential payout exceeds maximum treasury exposure.");
      return;
    }

    setError("");
    const newTicket = {
      id: Date.now(),
      legs,
      betAmount,
      timestamp: new Date().toISOString(),
      result: "pending",
      combinedPayout: getCombinedPayout()
    };
    setHistory([newTicket, ...history]);
    setLegs([]);
  };

  const liveCombinedProbability = useMemo(() => getCombinedProb(), [legs]);
  const livePotentialPayout = useMemo(() => {
    const prob = getCombinedProb();
    return betAmount * calculatePayoutOdds(Math.min(prob, 0.25));
  }, [legs, betAmount]);

  const selectedRangePercent = useMemo(() => {
    if (!lowerBound || !upperBound || upperBound <= lowerBound || livePrice === 0) return null;
    const range = ((upperBound - lowerBound) / livePrice) * 100;
    return range.toFixed(2);
  }, [lowerBound, upperBound, livePrice]);

  return (
    <div className="p-4 space-y-6">
      <Card>
        <CardContent className="space-y-4">
          <h2 className="text-xl font-bold">Parlay Builder</h2>
          <div className="grid grid-cols-2 gap-4">
            <select value={selectedAsset} onChange={e => setSelectedAsset(e.target.value)}>
              {Object.keys(ASSETS).map(key => (
                <option key={key} value={key}>{ASSETS[key].name}</option>
              ))}
            </select>
            <select value={timeframe} onChange={e => setTimeframe(e.target.value)}>
              {Object.keys(TIMEFRAMES).map(tf => (
                <option key={tf} value={tf}>{tf}</option>
              ))}
            </select>
            <input type="number" placeholder="Lower Bound" value={lowerBound} onChange={e => setLowerBound(parseFloat(e.target.value))} />
            <input type="number" placeholder="Upper Bound" value={upperBound} onChange={e => setUpperBound(parseFloat(e.target.value))} />
          </div>
          <div>
            <p className="text-sm text-gray-600">Live {ASSETS[selectedAsset].name} price: ${livePrice ? livePrice.toLocaleString() : "..."}</p>
            {selectedRangePercent && (
              <p className="text-sm text-gray-600">Selected range width: {selectedRangePercent}%</p>
            )}
          </div>
          {error && <p className="text-red-600 font-semibold">{error}</p>}
          <Button onClick={addLeg}>Add to Parlay</Button>
          <div className="mt-4">
            <h3 className="font-semibold">Current Ticket:</h3>
            <ul>
              {legs.map((leg, idx) => (
                <li key={idx} className="flex justify-between items-center">
                  <span>{leg.asset} | {leg.timeframe} | ${leg.lowerBound} - ${leg.upperBound} | P: {(leg.probability * 100).toFixed(2)}% | Odds: {leg.payoutOdds.toFixed(2)}x</span>
                  <Button variant="outline" onClick={() => removeLeg(idx)}>Remove</Button>
                </li>
              ))}
            </ul>
            <div className="mt-2">Combined Payout Odds: {getCombinedPayout()}x</div>
            <div className={`mt-1 ${liveCombinedProbability > 0.25 ? 'text-red-600' : 'text-green-600'}`}>
              Combined Win Probability: {(liveCombinedProbability * 100).toFixed(2)}%
            </div>
            <div className={`mt-1 ${livePotentialPayout > TREASURY_SIZE * MAX_PAYOUT_PERCENTAGE ? 'text-red-600' : 'text-green-600'}`}>
              Potential Payout: ${livePotentialPayout.toFixed(2)}
            </div>
            <input type="number" placeholder="Bet Amount" value={betAmount} onChange={e => setBetAmount(parseFloat(e.target.value))} />
            <Button onClick={placeBet} className="mt-2">Place Bet</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <h2 className="text-xl font-bold mb-4">Bet History</h2>
          <ul className="space-y-2">
            {history.map(ticket => (
              <li key={ticket.id} className="border-b pb-2">
                <div>Placed on: {new Date(ticket.timestamp).toLocaleString()}</div>
                <div>Amount: ${ticket.betAmount}</div>
                <div>Combined Odds: {ticket.combinedPayout}x</div>
                <div>Legs:</div>
                <ul className="ml-4 list-disc">
                  {ticket.legs.map((leg, idx) => (
                    <li key={idx}>{leg.asset} | {leg.timeframe} | ${leg.lowerBound} - ${leg.upperBound} | P: {(leg.probability * 100).toFixed(2)}% | Odds: {leg.payoutOdds.toFixed(2)}x</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
