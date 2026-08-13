"use client";

import { useEffect, useRef } from "react";
import styles from "./goal-flock.module.css";

const viewWidth = 760;
const viewHeight = 270;
const agentCount = 8;
const baseAgentSpeed = 78 * 1.2;
const orbitSpeed = 0.62;
const turnSpeed = 3.8;
const progressDuration = 5_200;
const completedHold = 1_200;
const completedFade = 800;
const interGoalDelay = 1_600;

type AgentState = {
  heading: number;
  speedScale: number;
  wanderPhase: number;
  wanderRate: number;
  x: number;
  y: number;
};

type GoalState = {
  completedAt: number | null;
  orbitDirection: number;
  progress: number;
  radii: number[];
  slots: number[];
  startedAt: number;
  x: number;
  y: number;
};

function between(minimum: number, maximum: number) {
  return minimum + Math.random() * (maximum - minimum);
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function distance(
  firstX: number,
  firstY: number,
  secondX: number,
  secondY: number
) {
  return Math.hypot(firstX - secondX, firstY - secondY);
}

function shuffle<T>(values: T[]) {
  for (let index = values.length - 1; index > 0; index--) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [values[index], values[swapIndex]] = [values[swapIndex]!, values[index]!];
  }

  return values;
}

function sampleUniformAxis(minimum: number, maximum: number) {
  const stratumWidth = (maximum - minimum) / agentCount;

  return shuffle(
    Array.from({ length: agentCount }, (_, index) =>
      between(
        minimum + index * stratumWidth,
        minimum + (index + 1) * stratumWidth
      )
    )
  );
}

function createAgents(): AgentState[] {
  const xCoordinates = sampleUniformAxis(35, viewWidth - 35);
  const yCoordinates = sampleUniformAxis(35, viewHeight - 35);

  return Array.from({ length: agentCount }, (_, index) => ({
    heading: between(-Math.PI, Math.PI),
    speedScale: between(0.88, 1.12),
    wanderPhase: between(0, Math.PI * 2),
    wanderRate: between(0.75, 1.35),
    x: xCoordinates[index]!,
    y: yCoordinates[index]!
  }));
}

function createGoal(
  agents: AgentState[],
  startedAt: number,
  previous?: GoalState,
  position?: { x: number; y: number }
): GoalState {
  const centerX = agents.reduce((sum, agent) => sum + agent.x, 0) / agents.length;
  const centerY = agents.reduce((sum, agent) => sum + agent.y, 0) / agents.length;
  let x = position ? clamp(position.x, 0, viewWidth) : between(110, viewWidth - 110);
  let y = position ? clamp(position.y, 0, viewHeight) : between(65, viewHeight - 65);

  for (
    let attempt = 0;
    !position &&
    attempt < 24 &&
    (distance(x, y, centerX, centerY) < 210 ||
      (previous && distance(x, y, previous.x, previous.y) < 190));
    attempt++
  ) {
    x = between(110, viewWidth - 110);
    y = between(65, viewHeight - 65);
  }

  const rotation = between(0, Math.PI * 2);
  const slots = Array.from(
    { length: agents.length },
    (_, index) => rotation + (Math.PI * 2 * index) / agents.length
  );

  shuffle(slots);

  return {
    completedAt: null,
    orbitDirection: Math.random() < 0.5 ? -1 : 1,
    progress: 0,
    radii: agents.map(() => between(31, 44)),
    slots,
    startedAt,
    x,
    y
  };
}

function shortestAngle(from: number, to: number) {
  return Math.atan2(Math.sin(to - from), Math.cos(to - from));
}

export function GoalFlock() {
  const agentElements = useRef<Array<SVGGElement | null>>([]);
  const completedGoal = useRef<SVGCircleElement>(null);
  const completedLabel = useRef<SVGTextElement>(null);
  const goalCore = useRef<SVGCircleElement>(null);
  const goalGroup = useRef<SVGGElement>(null);
  const goalHalo = useRef<SVGCircleElement>(null);
  const goalLabel = useRef<SVGTextElement>(null);
  const goalPulse = useRef<SVGCircleElement>(null);
  const goalScale = useRef<SVGGElement>(null);
  const motionGroup = useRef<SVGGElement>(null);
  const progressRing = useRef<SVGCircleElement>(null);
  const sceneElement = useRef<SVGSVGElement>(null);
  const staticGoal = useRef<SVGGElement>(null);

  useEffect(() => {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const agents = createAgents();
    let animationFrame = 0;
    let previousTime = performance.now();
    let goal: GoalState | null = null;
    let previousGoal: GoalState | undefined;
    let nextGoalAt = previousTime + interGoalDelay;

    const placeGoal = (x: number, y: number) => {
      if (goal) previousGoal = goal;
      goal = createGoal(agents, performance.now(), previousGoal, { x, y });
      staticGoal.current?.setAttribute(
        "transform",
        `translate(${goal.x.toFixed(2)} ${goal.y.toFixed(2)})`
      );
    };

    const handleClick = (event: MouseEvent) => {
      const scene = sceneElement.current;
      const transform = scene?.getScreenCTM();
      if (!scene || !transform) return;

      const cursor = scene.createSVGPoint();
      cursor.x = event.clientX;
      cursor.y = event.clientY;
      const position = cursor.matrixTransform(transform.inverse());
      placeGoal(position.x, position.y);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      placeGoal(viewWidth / 2, viewHeight / 2);
    };

    const renderGoal = (time: number) => {
      if (!goal) {
        goalGroup.current?.setAttribute("opacity", "0");
        return;
      }

      const completedAge =
        goal.completedAt === null ? null : time - goal.completedAt;
      const appearing = clamp((time - goal.startedAt) / 480, 0, 1);
      const fading =
        completedAge === null
          ? 1
          : 1 - clamp((completedAge - completedHold) / completedFade, 0, 1);
      const opacity = appearing * fading;
      const completion =
        completedAge === null ? 0 : clamp(completedAge / 280, 0, 1);
      const bounce =
        completedAge === null || completedAge > 520
          ? 1
          : 1 + Math.sin((completedAge / 520) * Math.PI) * 0.22;

      goalGroup.current?.setAttribute(
        "transform",
        `translate(${goal.x.toFixed(2)} ${goal.y.toFixed(2)})`
      );
      goalGroup.current?.setAttribute("opacity", opacity.toFixed(3));
      goalScale.current?.setAttribute("transform", `scale(${bounce.toFixed(3)})`);
      progressRing.current?.setAttribute(
        "stroke-dashoffset",
        (1 - goal.progress).toFixed(4)
      );
      completedGoal.current?.setAttribute("opacity", completion.toFixed(3));
      completedGoal.current?.setAttribute("r", (17 * completion).toFixed(2));
      goalCore.current?.setAttribute("opacity", (1 - completion).toFixed(3));
      goalLabel.current?.setAttribute("opacity", (1 - completion).toFixed(3));
      completedLabel.current?.setAttribute("opacity", completion.toFixed(3));

      const pulse =
        goal.completedAt === null ? 0.2 + Math.sin(time / 420) * 0.1 : 0;
      goalPulse.current?.setAttribute("opacity", pulse.toFixed(3));
      goalPulse.current?.setAttribute(
        "r",
        (27 + Math.sin(time / 420) * 3).toFixed(2)
      );
      goalHalo.current?.setAttribute("opacity", (opacity * 0.08).toFixed(3));
    };

    const animate = (time: number) => {
      const elapsed = Math.min(time - previousTime, 40);
      const seconds = elapsed / 1_000;
      previousTime = time;
      if (!goal && time >= nextGoalAt) {
        goal = createGoal(agents, time, previousGoal);
      }

      const activeGoal = goal;
      const orbitOffset = activeGoal
        ? ((time - activeGoal.startedAt) / 1_000) *
          orbitSpeed *
          activeGoal.orbitDirection
        : 0;
      let arrived = 0;

      agents.forEach((agent, index) => {
        let speed = baseAgentSpeed * agent.speedScale * 0.72;

        if (activeGoal) {
          const slot = activeGoal.slots[index]! + orbitOffset;
          const radius = activeGoal.radii[index]!;
          const targetX = activeGoal.x + Math.cos(slot) * radius;
          const targetY = activeGoal.y + Math.sin(slot) * radius;
          const targetAngle = Math.atan2(targetY - agent.y, targetX - agent.x);
          const targetDistance = distance(agent.x, agent.y, targetX, targetY);

          agent.heading += clamp(
            shortestAngle(agent.heading, targetAngle),
            -turnSpeed * seconds,
            turnSpeed * seconds
          );
          speed =
            baseAgentSpeed *
            agent.speedScale *
            (targetDistance < 75 ? 0.58 : 1);
        } else {
          agent.wanderPhase += seconds * agent.wanderRate;
          agent.heading += Math.sin(agent.wanderPhase) * 1.15 * seconds;

          if (
            agent.x < 48 ||
            agent.x > viewWidth - 48 ||
            agent.y < 48 ||
            agent.y > viewHeight - 48
          ) {
            const centerAngle = Math.atan2(
              viewHeight / 2 - agent.y,
              viewWidth / 2 - agent.x
            );
            agent.heading += clamp(
              shortestAngle(agent.heading, centerAngle),
              -turnSpeed * seconds,
              turnSpeed * seconds
            );
          }
        }

        agent.x += Math.cos(agent.heading) * speed * seconds;
        agent.y += Math.sin(agent.heading) * speed * seconds;
        agent.x = clamp(agent.x, 12, viewWidth - 12);
        agent.y = clamp(agent.y, 12, viewHeight - 12);

        if (
          activeGoal &&
          distance(agent.x, agent.y, activeGoal.x, activeGoal.y) < 90
        ) {
          arrived++;
        }

        agentElements.current[index]?.setAttribute(
          "transform",
          `translate(${agent.x.toFixed(2)} ${agent.y.toFixed(2)}) rotate(${((agent.heading * 180) / Math.PI).toFixed(2)})`
        );
      });

      if (goal?.completedAt === null) {
        const arrivalRatio = arrived / agents.length;
        const ceiling = arrived === agents.length ? 1 : 0.9;
        goal.progress = Math.min(
          ceiling,
          goal.progress +
            (elapsed / progressDuration) * (0.35 + arrivalRatio * 0.65)
        );

        if (arrived === agents.length && goal.progress >= 0.999) {
          goal.progress = 1;
          goal.completedAt = time;
        }
      } else if (
        goal?.completedAt !== null &&
        goal?.completedAt !== undefined &&
        time - goal.completedAt >= completedHold + completedFade
      ) {
        previousGoal = goal;
        goal = null;
        nextGoalAt = time + interGoalDelay;
      }

      renderGoal(time);
      animationFrame = window.requestAnimationFrame(animate);
    };

    const scene = sceneElement.current;
    scene?.addEventListener("click", handleClick);
    scene?.addEventListener("keydown", handleKeyDown);

    if (reduceMotion) {
      return () => {
        scene?.removeEventListener("click", handleClick);
        scene?.removeEventListener("keydown", handleKeyDown);
      };
    }

    agents.forEach((agent, index) => {
      agentElements.current[index]?.setAttribute(
        "transform",
        `translate(${agent.x.toFixed(2)} ${agent.y.toFixed(2)}) rotate(${((agent.heading * 180) / Math.PI).toFixed(2)})`
      );
    });
    motionGroup.current?.setAttribute("opacity", "1");
    animationFrame = window.requestAnimationFrame(animate);

    return () => {
      window.cancelAnimationFrame(animationFrame);
      scene?.removeEventListener("click", handleClick);
      scene?.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  return (
    <figure className={styles.frame}>
      <svg
        aria-labelledby="goal-flock-title goal-flock-description"
        className={styles.scene}
        ref={sceneElement}
        role="button"
        tabIndex={0}
        viewBox={`0 0 ${viewWidth} ${viewHeight}`}
      >
        <title id="goal-flock-title">Click to set a goal for the agents</title>
        <desc id="goal-flock-description">
          Independently moving agents steer toward a goal, orbit it while its
          progress fills, then wander before the next goal appears. Click to
          replace the active goal at that position.
        </desc>

        <defs>
          <pattern
            height="24"
            id="goal-flock-grid"
            patternUnits="userSpaceOnUse"
            width="24"
          >
            <circle className={styles.gridDot} cx="1" cy="1" r="1" />
          </pattern>
        </defs>

        <rect className={styles.grid} height={viewHeight} width={viewWidth} />

        <g className={styles.animated} opacity="0" ref={motionGroup}>
          {Array.from({ length: agentCount }, (_, index) => (
            <g
              className={styles.agent}
              key={index}
              ref={(element) => {
                agentElements.current[index] = element;
              }}
            >
              <path
                className={styles.agentMark}
                d="M -8 -6 L 1 0 L -8 6"
                opacity={0.68 + (index % 3) * 0.14}
              />
            </g>
          ))}

          <g opacity="0" ref={goalGroup}>
            <circle className={styles.goalHalo} ref={goalHalo} r="92" />
            <g ref={goalScale}>
              <circle className={styles.goalPulse} fill="none" ref={goalPulse} r="27" />
              <circle className={styles.goalRing} r="18" />
              <circle
                className={styles.progressRing}
                pathLength="1"
                r="23"
                ref={progressRing}
                transform="rotate(-90)"
              />
              <circle
                className={styles.completedGoal}
                opacity="0"
                r="0"
                ref={completedGoal}
              />
              <circle className={styles.goalCore} r="3.5" ref={goalCore} />
              <text className={styles.goalLabel} ref={goalLabel} textAnchor="middle" y="-45">
                GOAL
              </text>
              <text
                className={`${styles.goalLabel} ${styles.completedLabel}`}
                opacity="0"
                ref={completedLabel}
                textAnchor="middle"
                y="-45"
              >
                DONE
              </text>
            </g>
          </g>
        </g>

        <g className={styles.still} ref={staticGoal} transform="translate(510 135)">
          <circle className={styles.goalHalo} opacity="0.08" r="92" />
          <circle className={styles.completedGoal} r="17" />
          <circle className={styles.progressRingComplete} r="23" />
          <text
            className={`${styles.goalLabel} ${styles.completedLabel}`}
            textAnchor="middle"
            y="-45"
          >
            DONE
          </text>
          {Array.from({ length: agentCount }, (_, index) => {
            const angle = (Math.PI * 2 * index) / agentCount;
            const x = Math.cos(angle) * 38;
            const y = Math.sin(angle) * 38;
            return (
              <path
                className={styles.agentMark}
                d={`M ${x - 8} ${y - 6} l 9 6 -9 6`}
                key={index}
              />
            );
          })}
        </g>
      </svg>
    </figure>
  );
}
