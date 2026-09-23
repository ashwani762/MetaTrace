// Copyright (c) 2026 MetaTrace Contributors
//
// This software is released under the MIT License.
// https://opensource.org/licenses/MIT

// Curated programs that each demonstrate one metaprogramming technique and what
// MetaTrace shows for it.

export interface Example {
  id: string;
  title: string;
  standard: string;
  hint: string; // What to look at after tracing
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'factorial',
    title: 'Recursion: Factorial',
    standard: 'c++17',
    hint: 'Each Factorial<N> instantiates Factorial<N-1> until the Factorial<0> base case. Step through to watch the values bubble back up.',
    code: `// Compile-time recursion with an explicit specialization as the base case
template <int N>
struct Factorial {
    static constexpr int value = N * Factorial<N - 1>::value;
};

template <>
struct Factorial<0> {
    static constexpr int value = 1;
};

int main() {
    constexpr int result = Factorial<5>::value;
    static_assert(result == 120);
    return 0;
}
`
  },
  {
    id: 'fibonacci',
    title: 'Memoization: Fibonacci',
    standard: 'c++17',
    hint: 'Fib<N> needs Fib<N-1> and Fib<N-2>, but each specialization is generated once. Dotted "reused" edges show the cache hits that keep this linear.',
    code: `// Naive recursion is exponential at runtime, but templates are memoized by the compiler
template <int N>
struct Fib {
    static constexpr long value = Fib<N - 1>::value + Fib<N - 2>::value;
};
template <> struct Fib<1> { static constexpr long value = 1; };
template <> struct Fib<0> { static constexpr long value = 0; };

int main() {
    constexpr long f = Fib<12>::value;
    static_assert(f == 144);
    return 0;
}
`
  },
  {
    id: 'sfinae',
    title: 'SFINAE: enable_if overloads',
    standard: 'c++17',
    hint: 'Open Overload Resolution: for each call one candidate is discarded with the exact enable_if condition that failed.',
    code: `#include <type_traits>

// Only viable for integers
template <typename T>
std::enable_if_t<std::is_integral_v<T>, T> twice(T v) { return v * 2; }

// Only viable for floating point
template <typename T>
std::enable_if_t<std::is_floating_point_v<T>, T> twice(T v) { return v + v; }

int main() {
    twice(21);    // integral overload wins
    twice(1.5);   // floating-point overload wins
    return 0;
}
`
  },
  {
    id: 'concepts',
    title: 'C++20 Concepts',
    standard: 'c++20',
    hint: 'Candidates whose requires-clause is not met are discarded; the Inspector names the concept and the exact expression that evaluated to false.',
    code: `#include <concepts>
#include <string>
#include <vector>

template <typename T> concept Number = std::integral<T> || std::floating_point<T>;
template <typename T> concept Container = requires(T c) { c.begin(); c.end(); typename T::value_type; };

template <Number T>    std::string describe(T)        { return "number"; }
template <Container T> std::string describe(const T&) { return "container"; }

int main() {
    describe(42);
    describe(std::vector<int>{1, 2, 3});
    return 0;
}
`
  },
  {
    id: 'partial',
    title: 'Partial specialization',
    standard: 'c++17',
    hint: 'Each Traits<X> picks the most specialized matching pattern. The Overload panel lists every pattern and marks the winner.',
    code: `// Pattern matching on types with partial specialization
template <typename T> struct Traits          { static constexpr const char* name = "value"; };
template <typename T> struct Traits<T*>      { static constexpr const char* name = "pointer"; };
template <typename T> struct Traits<const T> { static constexpr const char* name = "const"; };
template <typename T, int N> struct Traits<T[N]> { static constexpr int size = N; };

int main() {
    constexpr auto a = Traits<int>::name;
    constexpr auto b = Traits<double*>::name;
    constexpr auto c = Traits<const char>::name;
    constexpr auto d = Traits<float[8]>::size;
    return d;
}
`
  },
  {
    id: 'typelist',
    title: 'Type lists (MP11-style)',
    standard: 'c++17',
    hint: 'filter<> peels one type per step. Template Hotspots unrolls the recursion so you can see the list shrink.',
    code: `#include <type_traits>

template <typename... Ts> struct type_list {};

// Keep only the types that satisfy predicate P
template <typename L, template <typename> class P> struct filter;
template <template <typename> class P> struct filter<type_list<>, P> { using type = type_list<>; };
template <typename H, typename... T, template <typename> class P>
struct filter<type_list<H, T...>, P> {
    using rest = typename filter<type_list<T...>, P>::type;
    template <typename R> struct prepend;
    template <typename... Rs> struct prepend<type_list<Rs...>> { using type = type_list<H, Rs...>; };
    using type = std::conditional_t<P<H>::value, typename prepend<rest>::type, rest>;
};

using Input  = type_list<int, float, char*, double, void*>;
using Output = filter<Input, std::is_arithmetic>::type;
static_assert(std::is_same_v<Output, type_list<int, float, double>>);

int main() { return 0; }
`
  },
  {
    id: 'variadic',
    title: 'Variadic packs & fold expressions',
    standard: 'c++17',
    hint: 'One instantiation per pack size. Each sum<...> call shows its deduced pack as argument chips.',
    code: `#include <cstddef>
#include <utility>

template <typename... Ts>
constexpr auto sum(Ts... xs) { return (xs + ... + 0); }

template <std::size_t... I>
constexpr std::size_t index_sum(std::index_sequence<I...>) { return (I + ... + 0); }

int main() {
    constexpr int a = sum(1, 2, 3);
    constexpr double b = sum(1.5, 2, 3u);
    constexpr auto c = index_sum(std::make_index_sequence<5>{});
    static_assert(a == 6 && c == 10);
    return 0;
}
`
  },
  {
    id: 'crtp',
    title: 'CRTP static polymorphism',
    standard: 'c++17',
    hint: 'Shape<Circle> and Shape<Square> are separate instantiations; area() is only generated for the derived types that are actually used.',
    code: `template <typename Derived>
struct Shape {
    constexpr double area() const { return static_cast<const Derived*>(this)->area_impl(); }
};

struct Circle : Shape<Circle> { double r; constexpr double area_impl() const { return 3.14159 * r * r; } };
struct Square : Shape<Square> { double s; constexpr double area_impl() const { return s * s; } };

template <typename S>
constexpr double total(const S& s) { return s.area(); }

int main() {
    constexpr Circle c{{}, 1.0};
    constexpr Square s{{}, 2.0};
    constexpr double t = total(c) + total(s);
    return static_cast<int>(t);
}
`
  },
  {
    id: 'constexpr-if',
    title: 'if constexpr dispatch',
    standard: 'c++17',
    hint: 'Only the taken branch is instantiated: to_str<int> never touches the string branch, so no error for types without .size().',
    code: `#include <string>
#include <type_traits>

template <typename T>
auto length(const T& v) {
    if constexpr (std::is_arithmetic_v<T>) return sizeof(T);
    else return v.size();
}

int main() {
    auto a = length(42);
    auto b = length(std::string("hello"));
    return static_cast<int>(a + b);
}
`
  },
];
