<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" :fill="color" :stroke="color" stroke-width="1.4"
    stroke-linejoin="round">
    <polyline v-if="course === 'od'" :points="points" fill="none" />
    <polygon v-else :points="points" fill="none" />
    <circle v-for="(p, i) in turnpoints[course]" :key="i" :cx="p[0]" :cy="p[1]" r="2.2" stroke="none" />
  </svg>
</template>

<script setup>
import { computed } from 'vue';

// Course icon (FAI triangle, flat triangle, free distance) with round turnpoints
const props = defineProps({
  course: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    default: 24
  },
  color: {
    type: String,
    default: 'currentColor'
  }
});

// Turnpoints of each course (24x24 viewBox)
const turnpoints = {
  fai: [[12, 3.5], [3, 19.5], [21, 19.5]],
  tri: [[14, 6.5], [2.5, 18.5], [21.5, 16.5]],
  od: [[3, 19], [8, 6], [15, 15], [21, 4]]
};

const points = computed(() => turnpoints[props.course].map(p => p.join(',')).join(' '));
</script>
