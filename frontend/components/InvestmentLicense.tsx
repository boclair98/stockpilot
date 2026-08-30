import {
  BadgeCheck,
  Check,
  ChevronRight,
  Circle,
  LockKeyhole,
  Route,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";

import { signInHref } from "@/lib/identity";

type LicenseMission = {
  key: string;
  title: string;
  description: string;
  current: number;
  target: number;
  unit: string;
  href: string;
  completed: boolean;
};

type LicenseStage = {
  key: string;
  level: number;
  title: string;
  summary: string;
  completed: boolean;
  status: "COMPLETED" | "ACTIVE" | "LOCKED";
  missions: LicenseMission[];
};

export type InvestmentLicenseData = {
  tier: string;
  progress: number;
  completedMissions: number;
  totalMissions: number;
  currentStage: string;
  nextMission: LicenseMission | null;
  stages: LicenseStage[];
  disclaimer: string;
};

function ProgressRing({ progress }: { progress: number }) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (Math.min(100, progress) / 100) * circumference;

  return (
    <div className="license-progress-ring" aria-label={`전체 면허 진행률 ${progress}%`}>
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <circle cx="50" cy="50" r={radius} />
        <circle
          className="license-progress-value"
          cx="50"
          cy="50"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span><strong>{progress}</strong><small>%</small></span>
    </div>
  );
}

export default function InvestmentLicense({
  authenticated,
  data,
}: {
  authenticated: boolean;
  data: InvestmentLicenseData;
}) {
  const activeStage = data.stages.find((stage) => stage.key === data.currentStage) ?? data.stages[0];
  if (!activeStage) return null;

  return (
    <section className="investment-license" aria-labelledby="license-title">
      <header className="license-heading">
        <div className="license-heading-icon"><BadgeCheck size={24} /></div>
        <div>
          <p>STOCKPILOT LICENSE</p>
          <h2 id="license-title">모의투자 면허</h2>
          <small>수익률이 아니라 계획·위험관리·복기 습관으로 단계가 올라갑니다.</small>
        </div>
        <span className="license-verified"><ShieldCheck size={13} /> 서버 기록 자동 판정</span>
      </header>

      <div className="license-overview">
        <ProgressRing progress={data.progress} />
        <div className="license-tier">
          <span>현재 등급</span>
          <h3>{data.tier}</h3>
          <p>LEVEL {activeStage.level} · {activeStage.title}</p>
          <small>{data.completedMissions}/{data.totalMissions}개 미션 완료</small>
        </div>
        <div className="license-next">
          <span><Route size={14} /> 다음 비행 계획</span>
          {authenticated && data.nextMission ? (
            <>
              <b>{data.nextMission.title}</b>
              <p>{data.nextMission.description}</p>
              <Link href={data.nextMission.href}>지금 진행하기 <ChevronRight size={14} /></Link>
            </>
          ) : authenticated ? (
            <>
              <b>모든 면허를 완료했어요</b>
              <p>원칙을 지키며 새로운 시장 상황에서도 기록을 이어가세요.</p>
              <Link href="/#market-content">시장으로 이동 <ChevronRight size={14} /></Link>
            </>
          ) : (
            <>
              <b>내 거래 기록으로 면허 시작</b>
              <p>가상 체결과 투자일지를 안전하게 개인 계정에 연결해요.</p>
              <a href={signInHref("/growth")}>Google로 시작하기 <ChevronRight size={14} /></a>
            </>
          )}
        </div>
      </div>

      <div className="license-roadmap">
        {data.stages.map((stage) => (
          <details
            className={`license-stage ${stage.status.toLowerCase()}`}
            open={stage.status === "ACTIVE" ? true : undefined}
            key={stage.key}
          >
            <summary>
              <span className="license-level">
                {stage.completed ? <Check size={15} /> : stage.status === "LOCKED" ? <LockKeyhole size={14} /> : stage.level}
              </span>
              <span><b>{stage.title}</b><small>{stage.summary}</small></span>
              <em>{stage.missions.filter((mission) => mission.completed).length}/{stage.missions.length}</em>
              <ChevronRight className="license-chevron" size={16} />
            </summary>
            <div className="license-missions">
              {stage.missions.map((mission) => {
                const percent = Math.min(100, Math.round((mission.current / mission.target) * 100));
                return (
                  <article className={mission.completed ? "complete" : ""} key={mission.key}>
                    <span className="license-mission-status">
                      {mission.completed ? <Check size={13} /> : <Circle size={11} />}
                    </span>
                    <div>
                      <b>{mission.title}</b>
                      <p>{mission.description}</p>
                      <i><span style={{ width: `${percent}%` }} /></i>
                    </div>
                    <span className="license-mission-count">
                      {Math.min(mission.current, mission.target)}/{mission.target}{mission.unit}
                    </span>
                    {!mission.completed && stage.status !== "LOCKED" && (
                      <Link aria-label={`${mission.title} 진행하기`} href={mission.href}><ChevronRight size={14} /></Link>
                    )}
                  </article>
                );
              })}
            </div>
          </details>
        ))}
      </div>

      <p className="license-disclaimer"><LockKeyhole size={12} /> {data.disclaimer}</p>
    </section>
  );
}
