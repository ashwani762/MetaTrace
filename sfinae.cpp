#include <iostream>
#include <type_traits>

// ============================================================
//  SFINAE Demo – No custom headers required
//  Tests: void_t detection, enable_if overloads, negation
// ============================================================

// ── void_t helper ───────────────────────────────────────────
template<typename... Ts>
using void_t = void;

// ── Trait 1: Does T have a nested ::value_type ? ────────────
template<typename T, typename = void>
struct has_value_type : std::false_type {};

template<typename T>
struct has_value_type<T, void_t<typename T::value_type>>
    : std::true_type {};

// ── Trait 2: Is T dereferenceable (i.e. has operator*) ? ───
template<typename T, typename = void>
struct is_dereferenceable : std::false_type {};

template<typename T>
struct is_dereferenceable<T, void_t<decltype(*std::declval<T>())>>
    : std::true_type {};

// ── Trait 3: Does T have a callable .size() member ? ────────
template<typename T, typename = void>
struct has_size : std::false_type {};

template<typename T>
struct has_size<T, void_t<decltype(std::declval<T>().size())>>
    : std::true_type {};

// ── SFINAE function overloading via enable_if ────────────────
template<typename T>
typename std::enable_if<has_value_type<T>::value, const char*>::type
describe() { return "has value_type"; }

template<typename T>
typename std::enable_if<!has_value_type<T>::value, const char*>::type
describe() { return "no value_type"; }

// ── Test types ───────────────────────────────────────────────
struct Container  { using value_type = int; int size() { return 0; } };
struct Plain      {};
struct FakePtr    { int operator*() { return 42; } };

int main() {
    // has_value_type
    bool a = has_value_type<Container>::value;  // true
    bool b = has_value_type<Plain>::value;       // false
    bool c = has_value_type<int>::value;         // false
    bool d = has_value_type<int*>::value;        // false

    // is_dereferenceable
    bool e = is_dereferenceable<int*>::value;    // true
    bool f = is_dereferenceable<FakePtr>::value; // true
    bool g = is_dereferenceable<Plain>::value;   // false
    bool h = is_dereferenceable<int>::value;     // false

    // has_size
    bool i = has_size<Container>::value;         // true
    bool j = has_size<Plain>::value;             // false

    // enable_if overloads
    const char* r1 = describe<Container>();
    const char* r2 = describe<Plain>();

    std::cout << r1 << "\n" << r2 << "\n";
    return 0;
}
