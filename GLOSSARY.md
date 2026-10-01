# Slop or Not

Slop or Not lets a coding agent ask a user questions through MCP and presents those questions in a swipe-based interface.

## Language

**Question**:
A request from a coding agent for the user's input about coding work, phrased by the agent so it can be answered with yes or no. Its wording and supporting information remain fixed after submission.
_Avoid_: Task, notification

**Question card**:
The presentation of one Question that the user can swipe right for yes, left for no, or up to write a Custom answer.
_Avoid_: Task card

**Response**:
The user's answer to a Question: yes, no, or a Custom answer.
_Avoid_: Decision

**Custom answer**:
A free-text Response submitted through the swipe-up option instead of a yes or no Response. It may express a conditional answer, ask for clarification, or provide different direction.
_Avoid_: Context, annotation

**Inbox**:
The collection of Questions addressed to one pseudonymous user, across projects and Agent sessions.
_Avoid_: Session inbox, team inbox

**Agent session**:
An identified instance of a coding agent's work that submits Questions to an Inbox.
_Avoid_: User session

**Cancelled question**:
A Question that is no longer available for a Response because the submitting agent explicitly withdrew it.
_Avoid_: Timed-out question, disconnected question

**Priority command**:
An agent request to place a Question in the Priority queue.
_Avoid_: Blocking-first ordering, move-to-front command

**Priority queue**:
The collection of Pending questions marked as priority in an Inbox, ordered oldest first by original creation time. It supplies the next Question card whenever it is nonempty.
_Avoid_: Most-recent-priority-first queue

**Normal queue**:
The collection of Pending questions not marked as priority in an Inbox, ordered oldest first by original creation time. It supplies the next Question card when the Priority queue is empty.
_Avoid_: Blocking-first queue

**Undo window**:
The three-second period after a server-acknowledged yes or no swipe during which the user can withdraw that choice before it is committed for the agent. It continues if the user closes the page.
_Avoid_: Response editing

**Pending question**:
A Question that has not received a committed Response and has not been cancelled.
_Avoid_: Disconnected question

**Response history**:
The read-only record of committed Responses and their Questions, including project, Agent session, and timestamps.
_Avoid_: Editable answers

**Question ID**:
A UUIDv7 identifier chosen by the submitting agent, unique within its Inbox. Repeated submissions with the same Question ID identify the same Question, even after its content has expired.
_Avoid_: Server-assigned question ID, separate request key

**Expired question**:
A finished Question whose wording and Response are no longer available after seven days. Its Question ID cannot be reused within the Inbox.
_Avoid_: New question, deleted inbox
