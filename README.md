# TOPIK Flashcards

A free, browser-based flashcard app for studying Korean vocabulary for the TOPIK exam.

Live site:  
https://okbettyy.github.io/topik-flashcards/

This app runs fully in the browser and saves progress locally. No account is required.

---

## About

TOPIK Flashcards is designed for efficient vocabulary review using spaced repetition,
typing practice, and fast keyboard-based navigation.

It is meant as a lightweight alternative to apps like Quizlet or Anki, focused specifically on Korean learners.

---

## Features

- Flashcards with spaced repetition
- 3D flip animation
- Keyboard shortcuts
- Search and filtering
- Typing practice mode
- Progress tracking
- Known cards management
- Offline support (after first load)
- No ads, no login

---

## How to Use

### Open the App

Visit:

https://okbettyy.github.io/topik-flashcards/

---

### Import Vocabulary

Click **Import CSV** and upload your vocabulary file.

Your progress will be saved automatically.

---

### Review Cards

Click the card or press Space to flip.

Choose how well you remembered the word:

| Button   | Key | Meaning   |
|----------|-----|-----------|
| Again    | 1   | Forgot    |
| Learning | 2   | Almost    |
| Known    | 3   | Easy      |

The app schedules reviews automatically.

---

### Keyboard Shortcuts

| Key        | Action           |
|------------|------------------|
| Space      | Flip card        |
| 1 / 2 / 3  | Grade card       |
| ← / →      | Previous / Next  |

---

### Typing Mode

Enable Typing Mode to practice spelling.

The app allows small typos and close matches.

---

### Filters

You can filter cards by:

- Search term
- TOPIK level (A/B/C)
- Part of speech
- Auxiliary verbs (보조용언)

---

### Known Cards

The Known Cards page lets you:

- Browse mastered words
- Search known cards
- Reset individual cards

---

## CSV Format

Vocabulary files must be in CSV format.

Required columns:

| Column | Description        |
|--------|--------------------|
| 단어   | Korean word        |
| 풀이   | Meaning            |
| 품사   | Part of speech     |
| 등급   | Level (A/B/C)       |
| 순위   | Rank / ID          |

Example:

```csv
순위,단어,풀이,품사,등급
1,가격01,price,명,A
2,먹다01,to eat,동,A
3,빠르다01,fast,형,B
