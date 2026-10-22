"use client";
import { orderMoney, orderStatusLabels, seoulDate, sideLabel, type HistoryOrder } from "@/lib/order-history";

export default function OrderTimeline({orders}: {orders: HistoryOrder[]}) {
  return <ol className="history-list">{orders.map((order,index) => {
    const date = seoulDate(order.createdAt);
    const newDay = index===0 || date!==seoulDate(orders[index-1].createdAt);
    const direction = order.side === "BUY" ? "buy" : order.side === "SELL" ? "sell" : "";
    const url = order.market ? "/?" + new URLSearchParams({symbol:order.symbol,market:order.market,exchange:order.exchange,view:"detail"}) + "#instrument-workspace" : null;
    return <li key={order.id}>
      {newDay && <h3 className="history-day">{date.replaceAll("-",".")}</h3>}
      <div className="history-row">
        <span className={`history-side ${direction}`}>{sideLabel(order.side)}</span>
        <div className="history-identity">
          {url ? <a href={url}>{order.name || order.symbol}</a> : <b>{order.name || order.symbol}</b>}
          <span>{order.symbol} · {order.exchange}</span>
          <small>{order.quantity.toLocaleString("ko-KR",{maximumFractionDigits:6})}주 · {new Date(order.createdAt).toLocaleTimeString("ko-KR",{timeZone:"Asia/Seoul",hour:"2-digit",minute:"2-digit"})}</small>
        </div>
        <div className="history-result">
          <span className={`history-status ${order.status==="FILLED"?"filled":""}`}>{orderStatusLabels[order.status] || "상태 확인 중"}</span>
          <strong>{order.status==="FILLED" ? orderMoney(order.grossAmount,order.currency,10) : "—"}</strong>
          <small>{order.status==="FILLED" ? "체결금액 · 비용 제외" : "아직 체결되지 않았어요"}</small>
        </div>
      </div>
      <details className="history-details">
        <summary>{order.name || order.symbol} 주문 상세</summary>
        <dl>
          <div><dt>주문 방식</dt><dd>{{MARKET:"시장가",LIMIT:"지정가",STOP:"스톱",STOP_LIMIT:"스톱 지정가"}[order.orderType] || order.orderType}</dd></div>
          <div><dt>1주 체결가</dt><dd>{order.status==="FILLED"?orderMoney(order.fillPrice,order.currency):"—"}</dd></div>
          <div><dt>수수료</dt><dd>{orderMoney(order.fee,order.currency)}</dd></div>
          <div><dt>세금</dt><dd>{orderMoney(order.tax,order.currency)}</dd></div>
          {order.side==="SELL" && <div><dt>실현손익</dt><dd>{orderMoney(order.realizedPnl,order.currency)}</dd></div>}
          <div className="history-order-id"><dt>주문 번호</dt><dd>{order.id}</dd></div>
        </dl>
      </details>
    </li>;
  })}</ol>;
}
