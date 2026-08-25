"use client";

import { useState } from "react";
import {
  CONTRACT_DEFINITIONS,
  hasOutstandingContract,
} from "../lib/game/gameplay/contracts";
import { npcById, npcGreeting } from "../lib/game/npcs/authoredNpc";
import type { GameSnapshot } from "../lib/game/state";
import FeatureDialog from "./FeatureDialog";

interface DialoguePanelProps {
  snapshot: GameSnapshot;
  npcId: string;
  onClose(): void;
  onAcceptContract(contractId: string): void;
  onTurnInContract(contractId: string): void;
  onOpenOperations(): void;
}

export default function DialoguePanel({
  snapshot,
  npcId,
  onClose,
  onAcceptContract,
  onTurnInContract,
  onOpenOperations,
}: DialoguePanelProps) {
  const npc = npcById(npcId);
  const [selectedTopicId, setSelectedTopicId] = useState<string | null>(null);
  if (!npc) return null;
  const selectedTopic = npc.topics.find((topic) => topic.id === selectedTopicId) ?? null;
  const issued = CONTRACT_DEFINITIONS.filter((contract) => contract.issuerNpcId === npc.id);
  const hasOutstanding = hasOutstandingContract(snapshot.contractJournal);

  return (
    <FeatureDialog
      title={npc.name}
      titleId="dialogue-title"
      kicker={`FIELD PERSONNEL / ${npc.role.toUpperCase()}`}
      testId="dialogue-overlay"
      className="dialogue-panel"
      onClose={onClose}
      headerMeta={<span className="feature-header-meta">NAMED PERSONNEL</span>}
      footer={(
        <>
          <span>FIELD COORDINATION CHANNEL</span>
          <button type="button" className="text-action" onClick={onOpenOperations}>OPEN FULL JOURNAL →</button>
        </>
      )}
    >
      <div className="dialogue-layout">
        <aside className="npc-profile" aria-label={`${npc.name} profile`}>
          <div className="npc-portrait" aria-hidden="true">
            <i /><b /><span>MV</span>
          </div>
          <p>{npc.role}</p>
          <strong>{npcGreeting(snapshot.environment.totalMinutes, npc.id)}</strong>
          <small>Schedule-linked field personnel · text channel only</small>
        </aside>
        <div className="dialogue-body">
          <blockquote>{selectedTopic?.text ?? npc.introduction}</blockquote>
          <nav className="dialogue-topics" aria-label="Conversation topics">
            <button
              type="button"
              className={selectedTopicId === null ? "is-active" : ""}
              onClick={() => setSelectedTopicId(null)}
            >
              ASSIGNMENTS
            </button>
            {npc.topics.map((topic) => (
              <button
                key={topic.id}
                type="button"
                className={selectedTopicId === topic.id ? "is-active" : ""}
                onClick={() => setSelectedTopicId(topic.id)}
              >
                {topic.label.toUpperCase()}
              </button>
            ))}
          </nav>

          {selectedTopicId === null && (
            <div className="dialogue-contracts">
              {issued.map((contract) => {
                const progress = snapshot.contractJournal.contracts[contract.id];
                const status = progress?.status ?? "available";
                return (
                  <article key={contract.id}>
                    <div>
                      <span>{contract.code} / {status.toUpperCase()}</span>
                      <h3>{contract.title}</h3>
                      <p>{contract.summary}</p>
                    </div>
                    {!progress ? (
                      <button
                        type="button"
                        disabled={hasOutstanding}
                        onClick={() => onAcceptContract(contract.id)}
                      >
                        {hasOutstanding ? "ASSIGNMENT IN PROGRESS" : "ACCEPT"}
                      </button>
                    ) : progress.status === "ready" ? (
                      <button type="button" className="is-primary" onClick={() => onTurnInContract(contract.id)}>
                        TURN IN
                      </button>
                    ) : (
                      <strong className={`dialogue-status status-${progress.status}`}>
                        {progress.status === "completed" ? "FILED" : "TRACKING"}
                      </strong>
                    )}
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </FeatureDialog>
  );
}
