<template>
  <svg :width="size" :height="size" viewBox="0 0 32 32">
    <defs>
      <linearGradient :id="gradientId" x1="0" y1="0" x2="1" y2="1">
        <stop v-for="(color, i) in gradients[rank - 1]" :key="i" :offset="i / 2" :stop-color="color" />
      </linearGradient>
    </defs>
    <path :d="rosettePath" :fill="`url(#${gradientId})`" />
    <circle cx="16" cy="16" r="9" fill="none" stroke="rgba(255,255,255,0.75)" stroke-width="1.3" />
    <text x="16" y="20.5" text-anchor="middle" font-size="12" font-weight="800" fill="rgba(0,0,0,0.55)"
      font-family="Arial, sans-serif">{{ rank }}</text>
  </svg>
</template>

<script setup>
import { useId } from 'vue';

// Gold, silver or bronze rosette with the rank in the center
defineProps({
  rank: {
    type: Number,
    required: true
  },
  size: {
    type: Number,
    default: 30
  }
});

const gradientId = `rank-medal-${useId()}`;

const gradients = [
  ['#FFE57F', '#FFC107', '#FF8F00'],
  ['#F5F5F5', '#BDBDBD', '#8E8E8E'],
  ['#FFCCBC', '#D08A5B', '#9C5A2E']
];

// Star seal with 12 teeth, outer radius 14.5, inner radius 12
const rosettePath = Array.from({ length: 24 }, (_, k) => {
  const angle = (k * Math.PI) / 12;
  const radius = k % 2 ? 12 : 14.5;
  const x = (16 + radius * Math.cos(angle)).toFixed(2);
  const y = (16 + radius * Math.sin(angle)).toFixed(2);
  return `${k ? 'L' : 'M'}${x} ${y}`;
}).join('') + 'Z';
</script>
